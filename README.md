# epc-qr-payload

Dependency-free JavaScript parser and serializer for EPC QR/GiroCode payloads.

The library builds and parses the line-based EPC payload used for SEPA credit transfer QR codes. It does not render a QR matrix itself; instead it returns the payload plus the mandated QR parameters (`errorCorrectionLevel: "M"`, `maxVersion: 13`), so a QR core/renderer can consume it.

## Example

```js
import { generate, parse, validateIBAN } from './libs/EPCpayload.js'

const payload = generate({
  recipient: 'Franz Mustermann',
  iban: 'DE71110220330123456789',
  amount: 12.3,
  message: 'Invoice 123',
})

console.log(payload)
console.log(parse(payload))
console.log(validateIBAN('DE71110220330123456789'))
```

## API

### `generate(data, options?)`

Generates an EPC QR payload string.

Supported public aliases:

- `recipient` maps to EPC beneficiary name.
- `message` maps to unstructured remittance text.
- `reference` maps to structured remittance information (`AT-T009`, max. 35 characters). ISO 11649 RF creditor references are supported and can be required with `requireRfReference: true`.
- `encoding` maps to the EPC character set line.

### `parse(qrString, options?)`

Returns a result object:

```js
{
  valid: true,
  data: { /* normalized EPC payment data */ },
  error: null
}
```

Invalid payloads return `{ valid: false, data: null, error, validationError }`. Use `parseOrThrow(...)` or `EpcQrPayload.parse(...)` when you want exception-based parsing. Parsed payloads can include `warnings`, for example when a payload uses a non-EUR currency.

### Helpers

- `isEpcQR(qrString)` quickly checks whether a string is parseable as EPC QR content.
- `validate(data, options?)` returns `{ valid, errors }`.
- `validateIBAN(iban)` returns `{ valid, error? }`.
- `validateBIC(bic)` returns `{ valid, error? }`.
- `formatIBAN(iban)` formats an IBAN in groups of four for display.
- `EpcQrPayload` exposes the lower-level class API. `EpcCore` remains available as a compatibility alias.

## Scope

- Validates the 12 EPC data lines and preserves empty optional lines where needed.
- `generate(...)` uses `LF` to keep payloads compact and never adds a trailing line break after the last populated element. The lower-level class API can still serialize with `CRLF` when explicitly requested.
- Supports EPC character set ids `1` to `8`.
- Defaults to UTF-8 (`1`) and validates representability for ISO-8859 variants.
- Validates IBAN checksum, BIC format, EPC amount format/range, purpose length and reference/text exclusivity.
- Allows structured remittance information up to 35 characters; ISO 11649 RF checksum validation is available with `requireRfReference: true`.
- Accepts EPC amount values such as `EUR1`, `EUR12.3` and `EUR12.30`.
- Allows other 3-letter currency prefixes such as `CHF12.30` for practical interoperability, but returns warnings because strict EPC069-12 v3.1 uses EUR.
- `currency` can be passed for unprefixed amounts, for example `{ amount: '12.30', currency: 'CHF' }`. When the amount already contains a prefix, an explicit `currency` must match it.
- Tolerates common scanner artifacts when parsing, including a leading BOM, spaces around header lines and trailing line breaks.
- Parses EPC payloads back to plain JavaScript objects.

## Notes

EPC069-12 v3.1 lists the identification code as fixed `SCT`, so generation rejects `INST` by default. Use `allowInstant: true` when you explicitly want to create a practical SEPA Instant variant. Parsing remains tolerant and returns a warning when it sees `INST`.
