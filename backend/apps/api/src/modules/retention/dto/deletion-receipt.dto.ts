/**
 * The deletion receipt lives with the other C-37 … C-39 response shapes.
 *
 * Re-exported here because `DELETE /me` reads as a deletion route rather than an export
 * one, and a reader looking for the receipt should find it under the name it is called
 * by. One declaration, two import paths.
 */
export { DeletionReceiptResponseDto } from './data-export-response.dto';
