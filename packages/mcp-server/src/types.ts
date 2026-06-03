export interface SearchResult {
  chunkId: string;
  documentId: string;
  title: string;
  sectionPath: string;
  content: string;
  sourceUrl: string;
  score: number;
}
