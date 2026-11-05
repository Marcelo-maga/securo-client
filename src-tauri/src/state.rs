use tokio::sync::Mutex;

#[derive(Default)]
pub struct AppState(pub Mutex<()>);
