/** События документохранилища (Архстандарт §6, домен doc.*, канон AR-23). */
export const DOC_EVENTS = {
  fileCreated: 'doc.file.created.v1',
  fileEnriched: 'doc.file.enriched.v1', // → индекс поиска, педагог-парсер (textbook.parsed)
  fileVersioned: 'doc.file.versioned.v1',
  fileAccessChanged: 'doc.file.access_changed.v1',
  fileStatusChanged: 'doc.file.status_changed.v1',
  fileShared: 'doc.file.shared.v1',
  fileDeleted: 'doc.file.deleted.v1',
  docEdited: 'doc.doc.edited.v1',
} as const;

export interface FileCreatedV1 {
  fileId: string;
  s3Key: string; // внутри хранилища
  scope: string;
}
export interface FileEnrichedV1 {
  fileId: string;
  textExtract: string | null;
  tags: string[];
}
