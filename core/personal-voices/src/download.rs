use anyhow::{Result,bail};
use std::path::PathBuf;
pub fn download_if_necessary(path:&str)->Result<PathBuf>{
 if path.contains("://"){bail!("Network access is disabled in the Android voice engine");}
 let p=PathBuf::from(path); if !p.is_absolute() || !p.is_file(){bail!("Voice model asset must be an existing absolute local path");} Ok(p)
}
