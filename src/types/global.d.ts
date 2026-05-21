/// <reference types="vite/client" />

export {};

declare global {
  interface Window {
    rl27?: {
      version: string;
    };
  }
}
