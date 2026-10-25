use anyhow::{Result,bail};
use std::sync::Arc;
pub struct Tokenizer(tokenizers::Tokenizer);
impl Tokenizer {
 pub fn load(n:usize,path:&str,kind:&str)->Result<Self>{
  if kind!="tokenizers" && kind!="json"{bail!("Only packaged JSON tokenizer is supported");}
  let path=crate::download::download_if_necessary(path)?;
  let t=tokenizers::Tokenizer::from_file(path).map_err(|e|anyhow::anyhow!("{e}"))?;
  if t.get_vocab_size(true)!=n{bail!("Tokenizer vocabulary mismatch");} Ok(Self(t))
 }
 pub fn encode(&self,text:&str)->Result<Vec<u32>>{Ok(self.0.encode(text,true).map_err(|e|anyhow::anyhow!("{e}"))?.get_ids().to_vec())}
 pub fn decode(&self,t:&[u32])->Result<String>{self.0.decode(t,true).map_err(|e|anyhow::anyhow!("{e}"))}
}
pub struct SharedTokenizer(pub Arc<Tokenizer>);
impl ptts::Tokenizer for SharedTokenizer {
 fn encode(&self,s:&str)->xn::Result<Vec<u32>>{self.0.encode(s).map_err(|e|xn::Error::msg(e.to_string()))}
 fn decode(&self,t:&[u32])->xn::Result<String>{self.0.decode(t).map_err(|e|xn::Error::msg(e.to_string()))}
}
