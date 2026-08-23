#!/usr/bin/env node

// Compatibility shim for older release entrypoints. The real implementation
// is the shared MLX/Metal accelerator; callers may still import this path.
export { scoreCatalogKnowledgeModelBatch } from "./catalog-knowledge-model-accelerator.mjs";
