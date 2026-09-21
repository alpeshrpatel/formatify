/**
 * parquet/index.js — public surface of the Parquet format module.
 */
export {
  PARQUET_MAGIC,
  describeParquetType,
  flattenSchema,
  isParquetBytes,
  normalizeValue,
  readParquetMetadata,
  readParquetPreview,
  toAsyncBuffer,
} from './parquetReader.js';
export { codecLabel, PREVIEW_LIMIT, default as ParquetPanel } from './ParquetPanel.jsx';
