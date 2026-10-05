//! Provider-independent community contract. No local catalog is treated as a shared service.
//! A future HTTP adapter implements this boundary using docs/api/community.openapi.json.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub display_name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PublicationState { Pending, Published, Hidden, Rejected }

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MarketPost {
    pub id: String,
    pub author: Account,
    pub sticker_id: String,
    pub name: Option<String>,
    /// A server asset key, never a path to the original photo on the device.
    pub rendered_asset_id: String,
    pub state: PublicationState,
    pub revision: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Page<T> {
    pub items: Vec<T>,
    pub next_cursor: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PublishRequest {
    pub sticker_id: String,
    pub name: Option<String>,
    pub rendered_asset_id: String,
    /// Used to deduplicate a retry after a timeout.
    pub operation_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ModerationDecision { Published, Hidden, Rejected }

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModerationRequest {
    pub state: ModerationDecision,
    pub reason: String,
    pub expected_revision: u64,
}

/// The HTTP adapter reports authentication, access, concurrency and transport failures distinctly.
#[derive(Debug)]
pub enum CommunityError {
    Unauthenticated,
    Forbidden,
    Conflict,
    Unavailable,
    Invalid(String),
}

/// Calls run on a worker thread. Authentication/token storage belongs to the Tauri adapter;
/// the server determines the caller and their privileges from its verified session.
/// Public browsing and authenticated following use separate methods; an offline action must
/// never return a fake successful follow/publication.
pub trait CommunityBackend {
    fn current_account(&self) -> Result<Account, CommunityError>;
    fn market(&self, cursor: Option<&str>) -> Result<Page<MarketPost>, CommunityError>;
    fn set_follow(&self, account_id: &str, following: bool) -> Result<(), CommunityError>;
    fn publish(&self, request: PublishRequest) -> Result<MarketPost, CommunityError>;
    fn withdraw(&self, post_id: &str) -> Result<(), CommunityError>;
    fn report(&self, post_id: &str, reason: &str) -> Result<(), CommunityError>;
    fn moderation_queue(&self, cursor: Option<&str>) -> Result<Page<MarketPost>, CommunityError>;
    fn moderate(&self, post_id: &str, request: ModerationRequest) -> Result<MarketPost, CommunityError>;
}
