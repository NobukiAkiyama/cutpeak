export interface TokenResponse {
  access_token: string;
  expires_in: number | string;
  error?: string;
  error_description?: string;
}
export interface TokenClient {
  requestAccessToken(options?: { prompt?: string }): void;
}
export interface CodeResponse {
  code?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}
export interface CodeClient {
  requestCode(): void;
}
interface PickerView {
  setMimeTypes(value: string): PickerView;
  setIncludeFolders(value: boolean): PickerView;
  setSelectFolderEnabled(value: boolean): PickerView;
}
interface PickerResult {
  action: string;
  docs: { id: string }[];
}
interface PickerBuilder {
  setDeveloperKey(v: string): PickerBuilder;
  setAppId(v: string): PickerBuilder;
  setOAuthToken(v: string): PickerBuilder;
  setOrigin(v: string): PickerBuilder;
  addView(v: PickerView): PickerBuilder;
  setTitle(v: string): PickerBuilder;
  setCallback(fn: (data: PickerResult) => void): PickerBuilder;
  build(): { setVisible(v: boolean): void };
}
export interface GoogleSdk {
  accounts: {
    oauth2: {
      initCodeClient(options: {
        client_id: string;
        scope: string;
        ux_mode: 'popup';
        select_account?: boolean;
        callback: (response: CodeResponse) => void;
        error_callback: (error: { type: string; message?: string }) => void;
      }): CodeClient;
      initTokenClient(options: {
        client_id: string;
        scope: string;
        callback: (r: TokenResponse) => void;
        error_callback: (error: { type: string; message?: string }) => void;
      }): TokenClient;
      revoke(token: string, callback: () => void): void;
    };
  };
  picker: {
    DocsView: new (id: string) => PickerView;
    ViewId: { DOCS: string; FOLDERS: string };
    PickerBuilder: new () => PickerBuilder;
    Action: { PICKED: string; CANCEL: string };
  };
}
declare global {
  interface Window {
    google?: GoogleSdk;
    gapi?: { load(name: string, callback: () => void): void };
  }
}
