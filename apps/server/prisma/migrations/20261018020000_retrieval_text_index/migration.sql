CREATE INDEX "document_chunks_text_search_idx"
  ON "document_chunks" USING GIN (to_tsvector('english', text));
