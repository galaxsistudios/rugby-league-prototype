"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const node_path_1 = __importDefault(require("node:path"));
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const createWindow = () => {
    const win = new electron_1.BrowserWindow({
        width: 1600,
        height: 1000,
        minWidth: 1280,
        minHeight: 820,
        fullscreenable: true,
        autoHideMenuBar: true,
        webPreferences: {
            preload: node_path_1.default.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    win.maximize();
    win.webContents.on("before-input-event", (_event, input) => {
        if (input.type !== "keyDown") {
            return;
        }
        if (input.key === "F11") {
            win.setFullScreen(!win.isFullScreen());
            return;
        }
        if (input.key === "Escape" && win.isFullScreen()) {
            win.setFullScreen(false);
        }
    });
    if (isDev && process.env.VITE_DEV_SERVER_URL) {
        void win.loadURL(process.env.VITE_DEV_SERVER_URL);
        win.webContents.openDevTools({ mode: "detach" });
        return;
    }
    void win.loadFile(node_path_1.default.join(__dirname, "../dist/index.html"));
};
electron_1.app.whenReady().then(() => {
    createWindow();
    electron_1.app.on("activate", () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
electron_1.app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        electron_1.app.quit();
    }
});
