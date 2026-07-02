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
    'EUR12.30',
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
    name: "François D'Alsace S.A.",
    iban: 'FR1420041010050500013M02606',
    remittanceText: 'Client Marie',
  })

  const parsed = EpcCore.parse(result.bytes)
  assert.equal(parsed.characterSet, '2')
  assert.equal(parsed.name, "François D'Alsace S.A.")
})

test('requires BIC for version 001', () => {
  assert.throws(() => EpcCore.serialize({
    version: '001',
    name: 'Franz Mustermann',
    iban: 'DE71110220330123456789',
  }), /BIC is mandatory/)
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
    name: 'Name with euro €',
    iban: 'DE71110220330123456789',
  }), (error) => error instanceof EpcValidationError && error.field === 'characterSet')
})

test('encodes euro sign in ISO 8859-15', () => {
  const bytes = EpcCore.encode('EUR €', '8')
  assert.equal(bytes[4], 0xa4)
  assert.equal(EpcCore.decode(bytes, '8'), 'EUR €')
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

test('strict identification rejects INST when requested', () => {
  assert.throws(() => EpcCore.serialize({
    identification: 'INST',
    name: 'Franz Mustermann',
    iban: 'DE71110220330123456789',
  }, { strictIdentification: true }), /Identification must be SCT/)
})
