interface KeyState {
    key: string;
    failedAt: number | null;
}
interface KeyStateData {
    keys: KeyState[];
    lastUpdated: number;
}
export declare function loadKeyState(apiKeys: string[]): KeyStateData;
export declare function saveKeyState(state: KeyStateData): void;
export declare function markKeyFailed(state: KeyStateData, keyIndex: number): void;
export declare function getAvailableKeys(state: KeyStateData): {
    key: string;
    index: number;
}[];
export declare function getWorkingKey(state: KeyStateData): string | null;
export {};
