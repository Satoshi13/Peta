use std::fmt;

#[derive(Debug)]
pub enum Error {
    Db(rusqlite::Error),
    Io(std::io::Error),
    Image(String),
    /// Segmentation model could not be loaded or run.
    Model(String),
    Invalid(String),
    /// Today's one new Peta has already been confirmed.
    AlreadyUsedToday,
}

pub type Result<T> = std::result::Result<T, Error>;

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Db(e) => write!(f, "database error: {e}"),
            Error::Io(e) => write!(f, "io error: {e}"),
            Error::Image(e) => write!(f, "image error: {e}"),
            Error::Model(e) => write!(f, "segmentation model error: {e}"),
            Error::Invalid(e) => write!(f, "{e}"),
            Error::AlreadyUsedToday => write!(f, "already_used_today"),
        }
    }
}

impl std::error::Error for Error {}

impl From<rusqlite::Error> for Error {
    fn from(e: rusqlite::Error) -> Self {
        Error::Db(e)
    }
}
impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Error::Io(e)
    }
}
impl From<image::ImageError> for Error {
    fn from(e: image::ImageError) -> Self {
        Error::Image(e.to_string())
    }
}
