# Schemas

JSON Schema definitions for ghostagent.ninja off-chain data structures.

## `creator-pack-manifest.schema.json`

Vertical-agnostic manifest declaring the contents and provenance of a CDR-encrypted Creator Pack for a **Virtual Creator NFT** under `[name].creation.ip`.

- **Showcase vertical:** music (hackathon) — see `examples/music.manifest.json`
- **First-class verticals:** music, visual, writing, code
- **Open-ended:** any string accepted for `creatorType`; the four named verticals get strict `vertical.<type>` validation via conditional `allOf` / `if-then`
- **Spec:** see `docs/virtual-artist-nft.md` (companion productization doc)

### Layered population

The manifest is populated in stages as the provision flow progresses:

| Stage | Block | Populated by |
|---|---|---|
| Author time (offline) | `creator`, `contents`, `vertical`, `metadata` | Creator's local tooling |
| Attestation (Layer 1) | `provenance` | `PaperclipModule.submitAttestation` |
| Story IP registration (Layer 2) | `ip` | `registerIPAssetViaSafe` returns `ipId` |
| CDR encryption (Layer 3) | `cdr` | `cdr-vault.encryptFileLicenseGated` returns `vaultUuid` |

The encrypted pack ZIP itself contains a `manifest.json` at its root with the author-time fields. The `cdr.dataCid` + `cdr.vaultUuid` + `ip.*` are pinned in a **second, public** manifest (the IPA metadata pin) that references the encrypted pack — buyers see the public manifest, decrypt the pack, and find the full author-time manifest inside.

### Validation

```ts
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import schema from './creator-pack-manifest.schema.json';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

if (!validate(manifest)) {
  console.error(validate.errors);
}
```

### Versioning policy

- `schemaVersion` is semver
- Additive changes (new optional fields, new verticals) → minor bump
- Field renames / type changes / new required fields → major bump
- Old manifests are read-only after a major bump — never silent-migrate
