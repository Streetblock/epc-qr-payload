import assert from 'node:assert/strict'
import test from 'node:test'
import { EpcCore, EpcValidationError } from '../libs/EPCcore.js'

test('serializes a minimal UTF-8 EPC payload without trailing newline', () => {
  const result = EpcCore.create({
    name: 'Franz Mustermann',
    iban: 'DE71110220330123456789',
    amount: 12.3,
    remittanceText: 'Invoice 123',
  })

  assert.equal(result.payload, [
    'BCD',
    '002',
    '1',
    'SCT',
    '',
    'Franz Mustermann',
    'DE71110220330123456789',
    'EUR12.3',
    '',
    '',
    'Invoice 123',
  ].join('\n'))
  assert.equal(result.payload.endsWith('\n'), false)
  assert.deepEqual(result.qrOptions, { errorCorrectionLevel: 'M', maxVersion: 13 })
})

test('keeps optional empty lines before later populated fields', () => {
  const payload = EpcCore.serialize({
    name: 'Franz Mustermann',
    iban: 'DE71110220330123456789',
    information: 'Internal note',
  })

  const lines = payload.split('\n')
  assert.equal(lines.length, 12)
  assert.equal(lines[7], '')
  assert.equal(lines[8], '')
  assert.equal(lines[9], '')
  assert.equal(lines[10], '')
  assert.equal(lines[11], 'Internal note')
})

test('parses a serialized EPC payload back to a normalized model', () => {
  const payload = EpcCore.serialize({
    characterSet: '2',
    name: "Francois D'Alsace S.A.",
    iban: 'FR1420041010050500013M02606',
    amount: 'EUR12.30',
    remittanceText: 'Client: Marie Louise La Lune',
  })

  const parsed = EpcCore.parse(payload)
  assert.equal(parsed.characterSet, '2')
  assert.equal(parsed.name, "Francois D'Alsace S.A.")
  assert.equal(parsed.iban, 'FR1420041010050500013M02606')
  assert.equal(parsed.remittanceText, 'Client: Marie Louise La Lune')
})

test('detects character set from raw EPC bytes before decoding', () => {
  const result = EpcCore.create({
    characterSet: '2',
    name: "Fran\u00e7ois D'Alsace S.A.",
    iban: 'FR1420041010050500013M02606',
    remittanceText: 'Client Marie',
  })

  const parsed = EpcCore.parse(result.bytes)
  assert.equal(parsed.characterSet, '2')
  assert.equal(parsed.name, "Fran\u00e7ois D'Alsace S.A.")
})

test('requires BIC for version 001', () => {
  assert.throws(() => EpcCore.serialize({
    version: '001',
    name: 'Franz Mustermann',
    iban: 'DE71110220330123456789',
  }), /BIC is mandatory/)
})

test('accepts EPC amount forms with zero, one or two decimals', () => {
  assert.match(EpcCore.serialize({
    name: 'Franz Mustermann',
    iban: 'DE71110220330123456789',
    amount: 'EUR1',
  }), /\nEUR1$/)

  assert.match(EpcCore.serialize({
    name: 'Franz Mustermann',
    iban: 'DE71110220330123456789',
    amount: '12.3',
  }), /\nEUR12\.3$/)

  assert.match(EpcCore.serialize({
    name: 'Franz Mustermann',
    iban: 'DE71110220330123456789',
    amount: 'EUR12.30',
  }), /\nEUR12\.30$/)
})

test('rejects comma decimal separators in amount input', () => {
  assert.throws(() => EpcCore.serialize({
    name: 'Franz Mustermann',
    iban: 'DE71110220330123456789',
    amount: '12,30',
  }), /dot as decimal separator/)
})

test('rejects remittance reference and remittance text together', () => {
  assert.throws(() => EpcCore.serialize({
    name: 'Franz Mustermann',
    iban: 'DE71110220330123456789',
    remittanceReference: 'RF18539007547034',
    remittanceText: 'Invoice',
  }), /mutually exclusive/)
})

test('validates ISO 11649 RF reference checksum', () => {
  assert.throws(() => EpcCore.serialize({
    name: 'Franz Mustermann',
    iban: 'DE71110220330123456789',
    remittanceReference: 'RF00539007547034',
  }), /checksum/)
})

test('rejects characters not encodable in selected ISO character set', () => {
  assert.throws(() => EpcCore.serialize({
    characterSet: '2',
    name: 'Name with euro \u20ac',
    iban: 'DE71110220330123456789',
  }), (error) => error instanceof EpcValidationError && error.field === 'characterSet')
})

test('encodes euro sign in ISO 8859-15', () => {
  const bytes = EpcCore.encode('EUR \u20ac', '8')
  assert.equal(bytes[4], 0xa4)
  assert.equal(EpcCore.decode(bytes, '8'), 'EUR \u20ac')
})

test('roundtrips representative bytes for all EPC character sets', () => {
  const samples = [
    ['1', 'UTF-8 \u00e4\u20ac\u03a9\u0416'],
    ['2', EpcCore.decode(Uint8Array.from([0x41, 0xa1, 0xc0, 0xe9]), '2')],
    ['3', EpcCore.decode(Uint8Array.from([0x41, 0xa1, 0xc0, 0xe1]), '3')],
    ['4', EpcCore.decode(Uint8Array.from([0x41, 0xa1, 0xc0, 0xe1]), '4')],
    ['5', EpcCore.decode(Uint8Array.from([0x41, 0xa1, 0xc0, 0xe1]), '5')],
    ['6', EpcCore.decode(Uint8Array.from([0x41, 0xa1, 0xc0, 0xe1]), '6')],
    ['7', EpcCore.decode(Uint8Array.from([0x41, 0xa1, 0xc0, 0xe1]), '7')],
    ['8', EpcCore.decode(Uint8Array.from([0x41, 0xa1, 0xc0, 0xe1]), '8')],
  ]

  for (const [characterSet, text] of samples) {
    assert.equal(EpcCore.decode(EpcCore.encode(text, characterSet), characterSet), text)
  }
})

test('supports CRLF line endings consistently', () => {
  const payload = EpcCore.serialize({
    name: 'Franz Mustermann',
    iban: 'DE71110220330123456789',
  }, { lineEnding: '\r\n' })

  assert.match(payload, /\r\n/)
  assert.doesNotMatch(payload, /[^\r]\n/)
  assert.equal(EpcCore.parse(payload).lineEnding, '\r\n')
})

test('generation rejects INST unless explicitly allowed', () => {
  assert.throws(() => EpcCore.serialize({
    identification: 'INST',
    name: 'Franz Mustermann',
    iban: 'DE71110220330123456789',
  }), /Identification must be SCT/)

  assert.doesNotThrow(() => EpcCore.serialize({
    identification: 'INST',
    name: 'Franz Mustermann',
    iban: 'DE71110220330123456789',
  }, { allowInstant: true }))
})

test('parsing tolerates INST and returns a compatibility warning', () => {
  const payload = [
    'BCD',
    '002',
    '1',
    'INST',
    '',
    'Franz Mustermann',
    'DE71110220330123456789',
  ].join('\n')

  const parsed = EpcCore.parse(payload)
  assert.equal(parsed.identification, 'INST')
  assert.equal(parsed.warnings.length, 1)
  assert.match(parsed.warnings[0], /outside strict EPC069-12/)
})

test('parsing tolerates scanner BOM, header spaces and trailing newlines', () => {
  const payload = [
    '\uFEFF BCD ',
    ' 002 ',
    ' 1 ',
    ' SCT ',
    '',
    ' Franz Mustermann ',
    ' DE71110220330123456789 ',
  ].join('\n') + '\n\n'

  const parsed = EpcCore.parse(payload)
  assert.equal(parsed.version, '002')
  assert.equal(parsed.characterSet, '1')
  assert.equal(parsed.identification, 'SCT')
  assert.equal(parsed.name, 'Franz Mustermann')
  assert.equal(parsed.iban, 'DE71110220330123456789')
})
