import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("rl27", {
  version: "0.1.0",
});
