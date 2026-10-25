//! Private stdio bridge. No network, file-path input, or plaintext disk cache.
use serde_json::{json, Value};
use std::{
    io::{self, BufRead, Read, Write},
    sync::Arc,
};
use thingsbook::{new_salt, DocumentSession, LibraryBook, LibrarySession, VaultSession};
use zeroize::Zeroizing;

const MAX_BOOK: usize = 100 * 1024 * 1024;
const MAX_INDEX: usize = 64 * 1024 * 1024;
struct Upload {
    bytes: Zeroizing<Vec<u8>>,
    size: usize,
    format: String,
    id: String,
    title: String,
    author: String,
}
struct Bridge {
    library: Arc<LibrarySession>,
    upload: Option<Upload>,
    indexed_bytes: usize,
}
type Result<T> = std::result::Result<T, String>;
fn invalid() -> String {
    "Invalid native core request".into()
}
fn string(v: &Value, key: &str, limit: usize) -> Result<String> {
    let value = v.get(key).and_then(Value::as_str).ok_or_else(invalid)?;
    if value.len() > limit || value.contains('\0') {
        return Err(invalid());
    }
    Ok(value.into())
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
fn decode(value: &str) -> Result<Zeroizing<Vec<u8>>> {
    if !value.len().is_multiple_of(2) || value.len() > 128 * 1024 {
        return Err(invalid());
    }
    let mut bytes = Zeroizing::new(Vec::with_capacity(value.len() / 2));
    for chunk in value.as_bytes().as_chunks::<2>().0 {
        let digits = std::str::from_utf8(chunk).map_err(|_| invalid())?;
        bytes.push(u8::from_str_radix(digits, 16).map_err(|_| invalid())?);
    }
    Ok(bytes)
}
impl Bridge {
    fn new() -> Result<Self> {
        let password = hex(&[new_salt(), new_salt()].concat());
        let vault = VaultSession::new(password, new_salt()).map_err(|e| e.to_string())?;
        Ok(Self {
            library: LibrarySession::new(vault).map_err(|e| e.to_string())?,
            upload: None,
            indexed_bytes: 0,
        })
    }
    fn command(&mut self, request: &Value) -> Result<Value> {
        match request
            .get("op")
            .and_then(Value::as_str)
            .ok_or_else(invalid)?
        {
            "ping" => Ok(
                json!({"engine":"thingsbook-rust","schema":1,"formats":["EPUB","TXT"],"storage":"memory-only"}),
            ),
            "begin" => {
                let size = request
                    .get("size")
                    .and_then(Value::as_u64)
                    .ok_or_else(invalid)?;
                let format = string(request, "format", 8)?;
                if size == 0
                    || size > MAX_BOOK as u64
                    || !["EPUB", "TXT"].contains(&format.as_str())
                {
                    return Err(invalid());
                }
                let id = string(request, "bookId", 100)?;
                if id.is_empty() {
                    return Err(invalid());
                }
                self.upload = Some(Upload {
                    bytes: Zeroizing::new(Vec::new()),
                    size: size as usize,
                    format,
                    id,
                    title: string(request, "title", 2000)?,
                    author: string(request, "author", 2000)?,
                });
                Ok(json!(true))
            }
            "chunk" => {
                let bytes = decode(&string(request, "hex", 128 * 1024)?)?;
                let upload = self.upload.as_mut().ok_or_else(invalid)?;
                if upload.bytes.len() + bytes.len() > upload.size {
                    self.upload = None;
                    return Err(invalid());
                }
                upload.bytes.extend_from_slice(&bytes);
                Ok(json!(true))
            }
            "finish" => {
                let mut upload = self.upload.take().ok_or_else(invalid)?;
                if upload.bytes.len() != upload.size {
                    return Err(invalid());
                }
                let data = std::mem::take(&mut *upload.bytes);
                let document = DocumentSession::open(data, upload.format.clone())
                    .map_err(|e| e.to_string())?;
                let metadata = document.metadata().map_err(|e| e.to_string())?;
                let mut locations = Vec::new();
                let mut passages = Vec::new();
                let mut total = 0usize;
                for chapter in 0..metadata.chapters {
                    let text =
                        Zeroizing::new(document.chapter(chapter).map_err(|e| e.to_string())?);
                    let mut offset = 0;
                    let mut segment = 0;
                    while offset < text.len() {
                        let mut end = (offset + 32 * 1024).min(text.len());
                        while !text.is_char_boundary(end) {
                            end -= 1;
                        }
                        total += end - offset;
                        if total > 32 * 1024 * 1024
                            || self.indexed_bytes + total > MAX_INDEX
                            || passages.len() >= 10000
                        {
                            return Err(
                                "Native search memory limit reached; index fewer books".into()
                            );
                        }
                        locations.push(format!("chapter:{chapter}:segment:{segment}"));
                        passages.push(text[offset..end].to_owned());
                        offset = end;
                        segment += 1;
                    }
                }
                document.close().map_err(|e| e.to_string())?;
                self.library
                    .upsert_book(LibraryBook {
                        id: upload.id.clone(),
                        title: upload.title,
                        author: upload.author,
                        filepath: String::new(),
                        cover_path: String::new(),
                        format: upload.format,
                        file_size: upload.size as u64,
                        created_at: 0,
                    })
                    .map_err(|e| e.to_string())?;
                self.library
                    .index_passages(upload.id, locations, passages)
                    .map_err(|e| e.to_string())?;
                self.indexed_bytes += total;
                Ok(json!({"chapters":metadata.chapters,"textBytes":total}))
            }
            "search" => {
                let matches = self
                    .library
                    .search(string(request, "query", 1024)?, 20)
                    .map_err(|e| e.to_string())?;
                Ok(Value::Array(matches.into_iter().map(|item|json!({"bookId":item.book_id,"location":item.location,"text":item.text,"score":item.score})).collect()))
            }
            "lock" => {
                self.upload = None;
                self.library.lock().map_err(|e| e.to_string())?;
                Ok(json!(true))
            }
            _ => Err(invalid()),
        }
    }
}
fn main() {
    let Ok(mut bridge) = Bridge::new() else {
        return;
    };
    let input = io::stdin();
    let mut reader = input.lock();
    let mut output = io::stdout().lock();
    loop {
        let mut line = Zeroizing::new(String::new());
        match reader.by_ref().take(256 * 1024 + 1).read_line(&mut line) {
            Ok(0) | Err(_) => break,
            _ => {}
        }
        if line.len() > 256 * 1024 {
            break;
        }
        let response = match serde_json::from_str::<Value>(&line) {
            Ok(request) => match bridge.command(&request) {
                Ok(value) => json!({"id":request.get("id"),"value":value}),
                Err(error) => {
                    bridge.upload = None;
                    json!({"id":request.get("id"),"error":error})
                }
            },
            Err(_) => json!({"error":"Invalid native core request"}),
        };
        if writeln!(output, "{response}")
            .and_then(|_| output.flush())
            .is_err()
        {
            break;
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn private_index_and_lock() {
        let mut bridge = Bridge::new().unwrap();
        let bytes = "A private starlight passage. café 星".as_bytes();
        bridge.command(&json!({"op":"begin","size":bytes.len(),"format":"TXT","bookId":"b","title":"Title","author":"Writer"})).unwrap();
        bridge
            .command(&json!({"op":"chunk","hex":hex(bytes)}))
            .unwrap();
        bridge.command(&json!({"op":"finish"})).unwrap();
        let results = bridge
            .command(&json!({"op":"search","query":"starlight"}))
            .unwrap();
        assert_eq!(results[0]["bookId"], "b");
        bridge.command(&json!({"op":"lock"})).unwrap();
        assert!(bridge
            .command(&json!({"op":"search","query":"starlight"}))
            .is_err());
    }
    #[test]
    fn reject_invalid_or_incomplete_uploads() {
        assert!(decode("gg").is_err());
        assert!(decode("f").is_err());
        let mut bridge = Bridge::new().unwrap();
        assert!(bridge.command(&json!({"op":"chunk","hex":"ab"})).is_err());
        assert!(bridge
            .command(
                &json!({"op":"begin","size":1,"format":"PDF","bookId":"b","title":"x","author":"y"})
            )
            .is_err());
        bridge.command(&json!({"op":"begin","size":2,"format":"TXT","bookId":"b","title":"x","author":"y"})).unwrap();
        bridge.command(&json!({"op":"chunk","hex":"61"})).unwrap();
        assert!(bridge.command(&json!({"op":"finish"})).is_err());
    }
}
