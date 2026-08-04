/**
 * The frontend's half of the B-4 contract: one file per module in ARCHITECTURE.md §5, plus the
 * §2.3 envelope, the §2.4 error codes and the §4.1 enum registry.
 *
 * CI compares the exported OpenAPI document against this surface and fails on any undeclared
 * change (B-4). If a shape here disagrees with §5, the shape is the defect.
 */

export * from './analytics';
export * from './audit';
export * from './auth';
export * from './catalog';
export * from './categories';
export * from './common';
export * from './consents';
export * from './enquiries';
export * from './enums';
export * from './envelope';
export * from './error-codes';
export * from './files';
export * from './garment-images';
export * from './garments';
export * from './health';
export * from './invites';
export * from './moderation';
export * from './person-photos';
export * from './quota';
export * from './results';
export * from './settings';
export * from './share';
export * from './shortlist';
export * from './tryon';
export * from './users';
export * from './votes';
