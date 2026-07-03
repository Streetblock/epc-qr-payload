const SERVICE_TAG = 'BCD'
const DEFAULT_VERSION = '002'
const DEFAULT_CHARSET = '1'
const DEFAULT_IDENTIFICATION = 'SCT'
const DEFAULT_LINE_ENDING = '\n'
const MAX_PAYLOAD_BYTES = 331

const CHARACTER_SETS = {
  1: { id: '1', label: 'utf-8', name: 'UTF-8' },
  2: { id: '2', label: 'iso-8859-1', name: 'ISO 8859-1' },
  3: { id: '3', label: 'iso-8859-2', name: 'ISO 8859-2' },
  4: { id: '4', label: 'iso-8859-4', name: 'ISO 8859-4' },
  5: { id: '5', label: 'iso-8859-5', name: 'ISO 8859-5' },
  6: { id: '6', label: 'iso-8859-7', name: 'ISO 8859-7' },
  7: { id: '7', label: 'iso-8859-10', name: 'ISO 8859-10' },
  8: { id: '8', label: 'iso-8859-15', name: 'ISO 8859-15' },
}

const ISO_ENCODER_CACHE = new Map()

export class EpcQrPayload {
  static QR_OPTIONS = Object.freeze({
    errorCorrectionLevel: 'M',
    maxVersion: 13,
  })

  static create(input, options = {}) {
    const model = normalizePayment(input, options)
    const payload = serializePayment(model, options)
    const bytes = encodePayload(payload, model.characterSet)
    const warnings = collectWarnings(model)
    validatePayloadSize(bytes)

    return {
      payload,
      bytes,
      model,
      warnings,
      qrOptions: { ...EpcQrPayload.QR_OPTIONS },
    }
  }

  static serialize(input, options = {}) {
    return EpcQrPayload.create(input, options).payload
  }

  static parse(payload, options = {}) {
    const text = normalizePayloadInput(payload, options.characterSet)
    const lineEnding = detectLineEnding(text)
    const lines = text.split(lineEnding)
    if ((lines[0] || '').trim() !== SERVICE_TAG) {
      throw new EpcValidationError('serviceTag', 'EPC payload must start with BCD.')
    }

    if (lines.length < 7 || lines.length > 12) {
      throw new EpcValidationError('payload', 'EPC payload must contain between 7 and 12 lines.')
    }

    const padded = [...lines]
    while (padded.length < 12) padded.push('')

    const model = normalizePayment({
      version: padded[1],
      characterSet: padded[2],
      identification: padded[3],
      bic: padded[4],
      name: padded[5],
      iban: padded[6],
      amount: padded[7],
      purpose: padded[8],
      remittanceReference: padded[9],
      remittanceText: padded[10],
      information: padded[11],
    }, { ...options, allowInstant: true })

    const warnings = collectWarnings(model)
    if (model.identification === 'INST') {
      warnings.push('INST is outside strict EPC069-12 v3.1; SCT is the fixed identification code.')
    }

    return {
      ...model,
      lineEnding,
      warnings,
    }
  }

  static encode(text, characterSet = DEFAULT_CHARSET) {
    return encodePayload(text, characterSet)
  }

  static decode(bytes, characterSet = DEFAULT_CHARSET) {
    return decodePayload(bytes, characterSet)
  }

  static validate(input, options = {}) {
    EpcQrPayload.create(input, options)
    return true
  }
}

export { EpcQrPayload as EpcCore }

export class EpcValidationError extends Error {
  constructor(field, message) {
    super(message)
    this.name = 'EpcValidationError'
    this.field = field
  }
}

export { EpcValidationError as EpcError }

export function generate(data, options = {}) {
  return EpcQrPayload.serialize(normalizePublicPaymentInput(data, options), normalizeGenerateOptions(options))
}

export function parseOrThrow(qrString, options = {}) {
  return EpcQrPayload.parse(qrString, normalizePublicOptions(options))
}

export function parse(qrString, options = {}) {
  try {
    return {
      valid: true,
      data: parseOrThrow(qrString, options),
      error: null,
    }
  } catch (error) {
    return {
      valid: false,
      data: null,
      error: error instanceof Error ? error.message : String(error),
      validationError: toValidationError(error),
    }
  }
}

export const parseSafe = parse

export function isEpcQR(qrString) {
  return parse(qrString).valid
}

export function validate(data, options = {}) {
  try {
    const result = EpcQrPayload.create(normalizePublicPaymentInput(data, options), normalizeGenerateOptions(options))
    return {
      valid: true,
      errors: [],
      warnings: result.warnings,
    }
  } catch (error) {
    return {
      valid: false,
      errors: [toValidationError(error)],
      warnings: [],
    }
  }
}

export function validateIBAN(iban) {
  try {
    validateIban(normalizeIban(iban))
    return { valid: true }
  } catch (error) {
    return { valid: false, error: toValidationError(error) }
  }
}

export function validateBIC(bic, options = {}) {
  try {
    const normalizedBic = normalizeText(bic ?? '', 'bic').toUpperCase()
    if (!normalizedBic && !options.allowEmpty) {
      throw new EpcValidationError('bic', 'BIC is required.')
    }
    validateBic(normalizedBic, options.version || DEFAULT_VERSION)
    return { valid: true }
  } catch (error) {
    return { valid: false, error: toValidationError(error) }
  }
}

export function formatIBAN(iban) {
  return normalizeIban(iban).replace(/(.{4})/g, '$1 ').trim()
}

export function serializePayment(input, options = {}) {
  const model = normalizePayment(input, options)
  const lineEnding = normalizeLineEnding(options.lineEnding)
  const lines = [
    SERVICE_TAG,
    model.version,
    model.characterSet,
    model.identification,
    model.bic,
    model.name,
    model.iban,
    model.amount,
    model.purpose,
    model.remittanceReference,
    model.remittanceText,
    model.information,
  ]

  return trimTrailingEmptyLines(lines).join(lineEnding)
}

function normalizePublicPaymentInput(data, options = {}) {
  if (!data || typeof data !== 'object') return data

  const normalized = { ...data }
  const publicOptions = normalizePublicOptions(options)

  if (normalized.name === undefined && normalized.recipient !== undefined) {
    normalized.name = normalized.recipient
  }
  if (normalized.version === undefined && publicOptions.version !== undefined) {
    normalized.version = publicOptions.version
  }
  if (normalized.characterSet === undefined && publicOptions.characterSet !== undefined) {
    normalized.characterSet = publicOptions.characterSet
  }
  if (normalized.remittanceText === undefined && normalized.message !== undefined) {
    normalized.remittanceText = normalized.message
  }
  if (normalized.information === undefined && normalized.additionalInfo !== undefined) {
    normalized.information = normalized.additionalInfo
  }

  return normalized
}

function normalizePublicOptions(options = {}) {
  const normalized = { ...options }

  if (normalized.characterSet === undefined && normalized.encoding !== undefined) {
    normalized.characterSet = normalized.encoding
  }
  if (normalized.version !== undefined) {
    normalized.version = String(normalized.version)
  }

  return normalized
}

function normalizeGenerateOptions(options = {}) {
  const normalized = normalizePublicOptions(options)
  normalized.lineEnding = DEFAULT_LINE_ENDING
  return normalized
}

function toValidationError(error) {
  if (error instanceof EpcValidationError) {
    return {
      field: error.field,
      message: error.message,
    }
  }

  return {
    field: 'unknown',
    message: error instanceof Error ? error.message : String(error),
  }
}

export function normalizePayment(input, options = {}) {
  if (!input || typeof input !== 'object') {
    throw new EpcValidationError('payment', 'Payment data must be an object.')
  }

  const model = {
    version: normalizeFixed(input.version ?? DEFAULT_VERSION, 'version'),
    characterSet: normalizeCharacterSetId(input.characterSet ?? DEFAULT_CHARSET),
    identification: normalizeFixed(input.identification ?? DEFAULT_IDENTIFICATION, 'identification'),
    bic: normalizeText(input.bic ?? '', 'bic').toUpperCase(),
    name: normalizeText(input.name, 'name'),
    iban: normalizeIban(input.iban),
    amount: normalizeAmount(input.amount ?? '', input.currency),
    purpose: normalizeText(input.purpose ?? '', 'purpose').toUpperCase(),
    remittanceReference: normalizeText(input.remittanceReference ?? input.reference ?? '', 'remittanceReference').toUpperCase(),
    remittanceText: normalizeText(input.remittanceText ?? input.text ?? '', 'remittanceText'),
    information: normalizeText(input.information ?? '', 'information'),
  }

  validateVersion(model.version)
  validateCharacterSet(model.characterSet)
  validateIdentification(model.identification, options)
  validateBic(model.bic, model.version)
  validateLength('name', model.name, 1, 70)
  validateAlphaNumericText('name', model.name)
  validateIban(model.iban)
  if (model.amount) validateAmount(model.amount)
  validateLength('purpose', model.purpose, 0, 4)
  validatePurpose(model.purpose)
  validateRemittance(model.remittanceReference, model.remittanceText, options)
  validateLength('information', model.information, 0, 70)
  validateAlphaNumericText('information', model.information)
  validateEncodableFields(model)

  return model
}

export function encodePayload(text, characterSet = DEFAULT_CHARSET) {
  const id = normalizeCharacterSetId(characterSet)

  if (id === '1') {
    return new TextEncoder().encode(text)
  }

  return getIsoCodec(id).encode(text)
}

export function decodePayload(bytes, characterSet = DEFAULT_CHARSET) {
  const id = normalizeCharacterSetId(characterSet)
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)

  if (id === '1') {
    return new TextDecoder('utf-8', { fatal: true }).decode(input)
  }

  return getIsoCodec(id).decode(input)
}

export function isEncodable(text, characterSet = DEFAULT_CHARSET) {
  try {
    encodePayload(text, characterSet)
    return true
  } catch {
    return false
  }
}

function normalizePayloadInput(payload, fallbackCharacterSet = DEFAULT_CHARSET) {
  let text
  if (typeof payload === 'string') return normalizeScannedPayloadText(payload)
  if (payload instanceof Uint8Array || Array.isArray(payload)) {
    const bytes = payload instanceof Uint8Array ? payload : Uint8Array.from(payload)
    text = decodePayload(bytes, detectCharacterSetFromBytes(bytes, fallbackCharacterSet))
    return normalizeScannedPayloadText(text)
  }
  throw new EpcValidationError('payload', 'Payload must be a string or byte array.')
}

function detectCharacterSetFromBytes(bytes, fallbackCharacterSet) {
  const lines = []
  let current = ''
  let start = 0

  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    start = 3
  }

  for (let i = start; i < bytes.length && lines.length < 3; i += 1) {
    const byte = bytes[i]
    if (byte === 0x0d) continue
    if (byte === 0x0a) {
      lines.push(current)
      current = ''
      continue
    }
    if (byte > 0x7f) break
    current += String.fromCharCode(byte)
  }

  if (lines.length < 3 && current) lines.push(current)
  return (lines[0] || '').trim() === SERVICE_TAG && lines[2] ? lines[2].trim() : fallbackCharacterSet
}

function normalizeScannedPayloadText(text) {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/(?:\r\n|\n|\r)+$/g, '')
}

function detectLineEnding(text) {
  const hasCrLf = text.includes('\r\n')
  const hasLf = text.includes('\n')
  if (hasCrLf && text.replace(/\r\n/g, '').includes('\n')) {
    throw new EpcValidationError('lineEnding', 'Line endings must be consistent.')
  }
  return hasCrLf ? '\r\n' : hasLf ? '\n' : DEFAULT_LINE_ENDING
}

function normalizeLineEnding(lineEnding = DEFAULT_LINE_ENDING) {
  if (lineEnding !== '\n' && lineEnding !== '\r\n') {
    throw new EpcValidationError('lineEnding', 'Line ending must be LF or CRLF.')
  }
  return lineEnding
}

function trimTrailingEmptyLines(lines) {
  const result = [...lines]
  while (result.length > 0 && result[result.length - 1] === '') result.pop()
  return result
}

function normalizeFixed(value, field) {
  return normalizeText(value, field).toUpperCase()
}

function normalizeText(value, field) {
  if (value === undefined || value === null) {
    throw new EpcValidationError(field, `${field} is required.`)
  }
  const text = String(value).trim()
  if (/[\r\n]/.test(text)) {
    throw new EpcValidationError(field, `${field} must not contain line breaks.`)
  }
  return text
}

function normalizeIban(value) {
  return normalizeText(value, 'iban').replace(/\s+/g, '').toUpperCase()
}

function normalizeAmount(value, currency = 'EUR') {
  if (value === '' || value === null || value === undefined) return ''
  const normalizedCurrency = normalizeCurrency(currency)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new EpcValidationError('amount', 'Amount must be a finite number.')
    }
    return `${normalizedCurrency}${String(value)}`
  }

  const raw = String(value).trim()
  if (raw.includes(',')) {
    throw new EpcValidationError('amount', 'Amount must use a dot as decimal separator.')
  }
  if (/^\d+(\.\d{1,2})?$/.test(raw)) {
    return `${normalizedCurrency}${raw}`
  }
  if (/^[A-Za-z]{3}\d+(\.\d{1,2})?$/.test(raw)) {
    return `${raw.slice(0, 3).toUpperCase()}${raw.slice(3)}`
  }
  return raw
}

function normalizeCurrency(value) {
  const currency = String(value ?? 'EUR').trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new EpcValidationError('currency', 'Currency must be a 3-letter ISO-style code.')
  }
  return currency
}

function validateVersion(version) {
  if (version !== '001' && version !== '002') {
    throw new EpcValidationError('version', 'Version must be 001 or 002.')
  }
}

function validateCharacterSet(characterSet) {
  if (!CHARACTER_SETS[characterSet]) {
    throw new EpcValidationError('characterSet', 'Character set must be one of 1..8.')
  }
}

function validateIdentification(identification, options = {}) {
  const allowed = options.allowInstant ? ['SCT', 'INST'] : ['SCT']
  if (!allowed.includes(identification)) {
    throw new EpcValidationError('identification', `Identification must be ${allowed.join(' or ')}.`)
  }
}

function validateBic(bic, version) {
  if (!bic && version === '001') {
    throw new EpcValidationError('bic', 'BIC is mandatory for version 001.')
  }
  if (!bic) return
  if (!/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(bic)) {
    throw new EpcValidationError('bic', 'BIC must contain 8 or 11 uppercase letters/digits.')
  }
  validateAlphaNumericText('bic', bic)
}

function validateLength(field, value, min, max) {
  const length = [...value].length
  if (length < min || length > max) {
    throw new EpcValidationError(field, `${field} must be between ${min} and ${max} characters.`)
  }
}

function validateIban(iban) {
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) {
    throw new EpcValidationError('iban', 'IBAN format is invalid.')
  }
  if (iban.length < 15 || iban.length > 34 || mod97(iban.slice(4) + iban.slice(0, 4)) !== 1) {
    throw new EpcValidationError('iban', 'IBAN checksum is invalid.')
  }
}

function validateAmount(amount) {
  const match = amount.match(/^([A-Z]{3})(\d{1,9}(\.\d{1,2})?)$/)
  if (amount.length > 15 || !match) {
    throw new EpcValidationError('amount', 'Amount must use a 3-letter currency plus up to 12 numeric amount characters.')
  }
  const value = Number(match[2])
  if (value < 0.01 || value > 999999999.99) {
    throw new EpcValidationError('amount', 'Amount must be between 0.01 and 999999999.99.')
  }
}

function collectWarnings(model) {
  const warnings = []
  if (model.amount && !model.amount.startsWith('EUR')) {
    warnings.push(`Currency ${model.amount.slice(0, 3)} is outside strict EPC069-12 v3.1; EUR is the standard currency.`)
  }
  return warnings
}

function validatePurpose(purpose) {
  if (purpose && !/^[A-Z0-9]{1,4}$/.test(purpose)) {
    throw new EpcValidationError('purpose', 'Purpose must contain up to 4 uppercase letters/digits.')
  }
}

function validateRemittance(reference, text, options = {}) {
  if (reference && text) {
    throw new EpcValidationError('remittanceReference', 'Structured reference and remittance text are mutually exclusive.')
  }
  validateLength('remittanceReference', reference, 0, 35)
  validateLength('remittanceText', text, 0, 140)
  validateAlphaNumericText('remittanceReference', reference)
  validateAlphaNumericText('remittanceText', text)
  if (reference && options.requireRfReference) validateCreditorReference(reference)
}

function validateAlphaNumericText(field, value) {
  if (/[\u0000-\u001F\u007F]/.test(value)) {
    throw new EpcValidationError(field, `${field} must not contain control characters.`)
  }
}

function validateCreditorReference(reference) {
  if (!/^RF[0-9]{2}[A-Z0-9]{1,21}$/.test(reference)) {
    throw new EpcValidationError('remittanceReference', 'Structured reference must be an ISO 11649 RF creditor reference.')
  }
  if (mod97(reference.slice(4) + reference.slice(0, 4)) !== 1) {
    throw new EpcValidationError('remittanceReference', 'Structured reference checksum is invalid.')
  }
}

function validateEncodableFields(model) {
  const payload = serializeFieldsForEncodingCheck(model)
  encodePayload(payload, model.characterSet)
}

function validatePayloadSize(bytes) {
  if (bytes.length > MAX_PAYLOAD_BYTES) {
    throw new EpcValidationError('payload', `Payload must not exceed ${MAX_PAYLOAD_BYTES} bytes.`)
  }
}

function serializeFieldsForEncodingCheck(model) {
  return [
    SERVICE_TAG,
    model.version,
    model.characterSet,
    model.identification,
    model.bic,
    model.name,
    model.iban,
    model.amount,
    model.purpose,
    model.remittanceReference,
    model.remittanceText,
    model.information,
  ].join('\n')
}

function mod97(input) {
  let remainder = 0
  for (const char of input.toUpperCase()) {
    const value = /[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char
    for (const digit of value) {
      if (!/[0-9]/.test(digit)) {
        throw new EpcValidationError('checksum', 'Checksum input contains invalid characters.')
      }
      remainder = (remainder * 10 + Number(digit)) % 97
    }
  }
  return remainder
}

function normalizeCharacterSetId(characterSet) {
  const raw = String(characterSet).trim().toLowerCase()
  const matched = Object.values(CHARACTER_SETS).find((entry) => (
    entry.id === raw || entry.label === raw || entry.name.toLowerCase().replace(/\s+/g, '-') === raw
  ))
  if (!matched) {
    throw new EpcValidationError('characterSet', 'Character set must be one of 1..8.')
  }
  return matched.id
}

function getIsoCodec(characterSet) {
  const id = normalizeCharacterSetId(characterSet)
  if (ISO_ENCODER_CACHE.has(id)) return ISO_ENCODER_CACHE.get(id)

  const meta = CHARACTER_SETS[id]
  const decodeMap = buildDecodeMap(meta)
  const encodeMap = new Map()
  decodeMap.forEach((char, byte) => {
    if (!encodeMap.has(char)) encodeMap.set(char, byte)
  })

  const codec = {
    encode(text) {
      const output = []
      for (const char of text) {
        const byte = encodeMap.get(char)
        if (byte === undefined) {
          throw new EpcValidationError('characterSet', `Character "${char}" is not encodable in ${meta.name}.`)
        }
        output.push(byte)
      }
      return Uint8Array.from(output)
    },
    decode(bytes) {
      let text = ''
      for (const byte of bytes) {
        const char = decodeMap[byte]
        if (char === undefined) {
          throw new EpcValidationError('characterSet', `Byte 0x${byte.toString(16)} is not decodable in ${meta.name}.`)
        }
        text += char
      }
      return text
    },
  }

  ISO_ENCODER_CACHE.set(id, codec)
  return codec
}

function buildDecodeMap(meta) {
  if (meta.id === '2') {
    return Array.from({ length: 256 }, (_, byte) => String.fromCodePoint(byte))
  }

  const bytes = Uint8Array.from({ length: 256 }, (_, byte) => byte)
  const decoder = new TextDecoder(meta.label, { fatal: false })
  return [...decoder.decode(bytes)]
}
