export interface TextStats {
    lines: number;
    words: number;
    characters: number;
    topWords: string[];
}

export function textStats(text: string): TextStats {
    const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
    const counts = new Map<string, number>();
    for (const word of words.filter((w) => w.length > 3)) {
        counts.set(word, (counts.get(word) ?? 0) + 1);
    }
    const topWords = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([word, count]) => `${word} (${count})`);
    const lines = text.trim() === '' ? 0 : text.trimEnd().split('\n').length;
    return { lines, words: words.length, characters: text.length, topWords };
}
