/**
 * avro/index.js — public surface of the Avro format module.
 */
export {
  AVRO_MAGIC,
  AvroError,
  avroSchemaToTree,
  inflateDeflate,
  isAvroBytes,
  readAvroHeader,
  readAvroPreview,
  readDatum,
  scanAvroBlocks,
  collectNamedTypes,
} from './avroReader.js';
export { default as AvroPanel } from './AvroPanel.jsx';
