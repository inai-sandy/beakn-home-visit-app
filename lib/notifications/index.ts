// HVA-42: notifications barrel. Importing this module is a side-effect
// import — each handler file subscribes to its event on first load.
// Add new handlers by appending an import here AND ensuring the new
// handler file calls `on(event, fn)` at module top.
import './email-handlers/captain-new-request';
