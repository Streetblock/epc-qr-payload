# EPC Barcode Core

Dependency-free JavaScript core for EPC QR/GiroCode payloads.

The library builds and parses the line-based EPC payload used for SEPA credit transfer QR codes. It does not render a QR matrix itself; instead it returns the payload plus the mandated QR parameters (`errorCorrectionLevel: "M"`, `maxVersion: 13`), so a QR core/renderer can consume it.

## Example

```js
import { EpcCore } from './libs/EPCcore.js'

const epc = EpcCore.create({
  name: 'Franz Mustermann',
  iban: 'DE71110220330123456789',
  amount: 12.3,
  remittanceText: 'Invoice 123',
})

console.log(epc.payload)
console.log(epc.qrOptions)
```

## Scope

- Validates the 12 EPC data lines and preserves empty optional lines where needed.
- Uses `LF` by default and never adds a trailing line break after the last populated element.
- Supports EPC character set ids `1` to `8`.
- Defaults to UTF-8 (`1`) and validates representability for ISO-8859 variants.
- Validates IBAN checksum, BIC format, amount format/range, purpose length and reference/text exclusivity.
- Parses EPC payloads back to plain JavaScript objects.

## Notes

EPC069-12 v3.1 lists the identification code as fixed `SCT`, so generation rejects `INST` by default. Use `allowInstant: true` when you explicitly want to create a practical SEPA Instant variant. Parsing remains tolerant and returns a warning when it sees `INST`.
