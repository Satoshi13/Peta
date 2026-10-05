// Standalone arrival regression harness: commands need no IPC wrapper in the fake runtime.
extern crate proc_macro;
#[proc_macro_attribute]
pub fn command(_: proc_macro::TokenStream, item: proc_macro::TokenStream) -> proc_macro::TokenStream {
    item
}
