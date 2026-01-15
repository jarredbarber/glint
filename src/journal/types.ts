export interface JournalSection {
    file: string;
    fileTitle: string;
    title: string;
    content: string;
    startLine: number;
    endLine: number;
}

export interface DateGroup {
    date: string; // YYYY-MM-DD
    sections: JournalSection[];
}

export interface FileJournal {
    path: string;
    mtime: number;
    sections: JournalSection[];
}
