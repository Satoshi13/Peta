//! An offline owner tool. Signing secrets are never printed, logged or embedded in the app.
use std::{path::{Path,PathBuf},io::Read};
use clap::{Parser,Subcommand,Args};
use peta_core::{device_key,events::{self,Event,Attachment},sign::{self,Signer}};
#[derive(Parser)]
#[command(name="peta-pass",about="Create and inspect offline signed Peta distributions")]
struct Cli {#[command(subcommand)] command:Command}
#[derive(Args)]
struct Issuer {
    /// Private key path, or PETA_SIGNING_KEY. Never pass the key's contents.
    #[arg(long)] key:Option<PathBuf>,
    #[arg(long,default_value="k1")] key_id:String,
    #[arg(long)] id:String,
    #[arg(long)] not_before:Option<String>,
    #[arg(long)] not_after:String,
    #[arg(long,default_value="From Peta")] title:String,
    #[arg(long,default_value="")] message:String,
}
#[derive(Subcommand)]
enum Command {
    /// Generate a private key in a NEW 0600 file. The owner runs this outside the repository.
    Keygen {#[arg(long)] out:PathBuf},
    /// Print only the Base64 public key and fingerprint.
    Pubkey {key:PathBuf},
    Event {
        #[command(flatten)] issuer:Issuer,
        #[arg(long)] kind:String,
        #[arg(long)] count:Option<i64>,
        #[arg(long)] material:Option<String>,
        #[arg(long)] revoke_id:Option<String>,
        #[arg(long)] png:Option<PathBuf>,
        #[arg(long)] mask:Option<PathBuf>,
        #[arg(long)] out:Option<PathBuf>,
        #[arg(long)] as_code:bool,
    },
    GrantPack {#[command(flatten)] issuer:Issuer,#[arg(long)] pack:PathBuf,#[arg(long)] dir:PathBuf,#[arg(long)] out:PathBuf},
    /// Verify without applying. --public-key tests an explicitly supplied public key, not built-in trust.
    Verify {file:PathBuf,#[arg(long)] public_key:Option<String>},
}
fn read(path:&Path,limit:usize)->Result<Vec<u8>,String> {
    let mut bytes=Vec::new();std::fs::File::open(path).map_err(|e|e.to_string())?.take((limit+1) as u64).read_to_end(&mut bytes).map_err(|e|e.to_string())?;
    if bytes.len()>limit{return Err("Input file exceeds its size limit.".into());}Ok(bytes)
}
fn header(i:&Issuer,kind:&str,payload:serde_json::Value)->Event {
    Event{event_id:i.id.clone(),kind:kind.into(),issued_at:peta_core::db::now(),not_before:i.not_before.clone(),not_after:Some(i.not_after.clone()),title:i.title.clone(),message:i.message.clone(),payload,signer:Signer::Official{key_id:i.key_id.clone()},attachments:vec![]}
}
fn issue(i:&Issuer,event:&Event,body:&[u8],out:Option<&Path>,as_code:bool)->Result<(),String> {
    let path=i.key.clone().or_else(||std::env::var_os("PETA_SIGNING_KEY").map(PathBuf::from)).ok_or("Use --key or PETA_SIGNING_KEY to select a private key file.")?;
    let key=device_key::load(&path).map_err(|e|e.to_string())?;
    let bytes=events::encode(event,body,&key).map_err(|e|e.to_string())?;
    events::decode_with(&bytes,|_|Ok(key.verifying_key())).map_err(|e|e.to_string())?;
    for date in [&event.not_before,&event.not_after].into_iter().flatten(){peta_core::events::validate_date(date).map_err(|e|e.to_string())?;}
    if out.is_none() && !as_code {return Err("Choose --out, --as-code, or both.".into());}
    let code=if as_code {Some(events::as_code(event,&key).map_err(|e|e.to_string())?)} else {None};
    if let Some(out)=out {use std::io::Write;let mut file=std::fs::OpenOptions::new().write(true).create_new(true).open(out).map_err(|e|format!("Choose a new output file: {e}"))?;file.write_all(&bytes).map_err(|e|e.to_string())?;file.sync_all().map_err(|e|e.to_string())?;println!("Saved {}",out.display());}
    if let Some(code)=code {println!("{code}");}Ok(())
}
fn run(cli:Cli)->Result<(),String> {
    match cli.command {
        Command::Keygen{out}=>{let key=sign::generate().map_err(|e|e.to_string())?;device_key::save_new(&out,&key).map_err(|e|e.to_string())?;println!("Private key saved. Back it up securely; never commit it.");},
        Command::Pubkey{key}=>{let key=device_key::load(&key).map_err(|e|e.to_string())?;println!("{}\nFingerprint: {}",sign::public_key(&key),sign::fingerprint(&key.verifying_key()));},
        Command::Event{issuer,kind,count,material,revoke_id,png,mask,out,as_code}=>{
            let mut attachments=Vec::new();let mut body=Vec::new();
            let payload=match kind.as_str(){
                "extra_envelope"=>{let count=count.filter(|c|(1..=3).contains(c)).ok_or("Use --count 1..3.")?;serde_json::json!({"count":count})},
                "grant_material"=>{let count=count.filter(|c|(1..=10).contains(c)).ok_or("Use --count 1..10.")?;let material=material.ok_or("Use --material.")?;if peta_core::materials::get(&material).is_none_or(|m|m.unlimited){return Err("Unknown material, or unlimited Matte.".into());}serde_json::json!({"count":count,"materialId":material})},
                "revoke"=>{let id=revoke_id.filter(|s|events::safe_id(s)).ok_or("Use --revoke-id with a valid event ID.")?;serde_json::json!({"eventId":id})},
                "grant_sticker"=>{let png=read(&png.ok_or("Use --png.")?,8*1024*1024)?;let mask=if let Some(path)=mask{read(&path,8*1024*1024)?}else{vec![]};attachments.push(Attachment{key:"sticker".into(),png_len:png.len(),mask_len:mask.len()});body.extend(png);body.extend(mask);serde_json::json!({})},
                _=>return Err("Unsupported kind. Packs use grant-pack.".into()),
            };
            let mut event=header(&issuer,&kind,payload);event.attachments=attachments;issue(&issuer,&event,&body,out.as_deref(),as_code)?;
        },
        Command::GrantPack{issuer,pack,dir,out}=>{
            let payload:serde_json::Value=serde_json::from_slice(&read(&pack,64*1024)?).map_err(|e|e.to_string())?;
            let items=payload["items"].as_array().ok_or("pack.json needs items.")?;
            if items.is_empty() || items.len()>24{return Err("Official packs need 1..24 pictures.".into());}
            for field in ["packId","title","author","pouch"]{if payload[field].as_str().is_none(){return Err(format!("pack.json needs {field}."));}}
            if !events::safe_id(payload["packId"].as_str().unwrap()) || !events::text(payload["title"].as_str().unwrap(),40) || !events::text(payload["author"].as_str().unwrap(),40) || !["kraft","matte","holo"].contains(&payload["pouch"].as_str().unwrap()){return Err("Invalid pack details.".into());}
            let mut event=header(&issuer,"grant_pack",payload.clone());let mut body=Vec::new();let mut keys=std::collections::HashSet::new();
            for item in items {let key=item["key"].as_str().filter(|s|events::safe_id(s)).ok_or("Invalid item key.")?;if !keys.insert(key) || !events::text(item["name"].as_str().unwrap_or(""),40) || !["common","uncommon","rare"].contains(&item["rarity"].as_str().unwrap_or("")){return Err("Invalid pack item.".into());}let png=read(&dir.join(format!("{key}.png")),8*1024*1024)?;event.attachments.push(Attachment{key:key.into(),png_len:png.len(),mask_len:0});body.extend(png);}
            issue(&issuer,&event,&body,Some(&out),false)?;
        },
        Command::Verify{file,public_key}=>{
            let bytes=read(&file,sign::MAX_FILE)?;
            if bytes.starts_with(events::MAGIC) {
                let verified=events::decode_with(&bytes,|signer|if let Some(key)=&public_key{sign::parse_public(key)}else{sign::resolve(signer)}).map_err(|e|e.to_string())?;
                println!("Signature valid{}; not applied.\n{}",if public_key.is_some(){" for the supplied public key (not built-in trust)"}else{" for a trusted official key"},serde_json::to_string_pretty(verified.header()).unwrap());
            }else if bytes.starts_with(b"PETAGIFT") {let gift=peta_core::gift::decode_gift(&bytes).map_err(|e|e.to_string())?;println!("Gift version {} ({}); not received.\n{}",bytes[8],if bytes[8]==1{"unsigned"}else{"device signature valid"},serde_json::to_string_pretty(&gift.header).unwrap());}
            else if bytes.starts_with(peta_core::creator_pack::MAGIC) {let pack=peta_core::creator_pack::decode(&bytes).map_err(|e|e.to_string())?;println!("Device signature valid; not added to any shelf.\n{}",serde_json::to_string_pretty(pack.header()).unwrap());}
            else {return Err("Unknown Peta file type.".into());}
        },
    }Ok(())
}
fn main(){if let Err(error)=run(Cli::parse()){eprintln!("peta-pass: {error}");std::process::exit(1);}}
