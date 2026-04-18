/// <reference types="web-bluetooth" />

// ESC/POS command constants
const ESC = 0x1b
const GS = 0x1d
const LF = 0x0a

const COMMANDS = {
  INIT: new Uint8Array([ESC, 0x40]),
  BOLD_ON: new Uint8Array([ESC, 0x45, 0x01]),
  BOLD_OFF: new Uint8Array([ESC, 0x45, 0x00]),
  ALIGN_CENTER: new Uint8Array([ESC, 0x61, 0x01]),
  ALIGN_LEFT: new Uint8Array([ESC, 0x61, 0x00]),
  ALIGN_RIGHT: new Uint8Array([ESC, 0x61, 0x02]),
  FONT_NORMAL: new Uint8Array([GS, 0x21, 0x00]),
  FONT_DOUBLE_HEIGHT: new Uint8Array([GS, 0x21, 0x01]),
  FONT_DOUBLE_WIDTH: new Uint8Array([GS, 0x21, 0x10]),
  FONT_DOUBLE: new Uint8Array([GS, 0x21, 0x11]),
  FONT_LARGE: new Uint8Array([GS, 0x21, 0x11]),
  FONT_A: new Uint8Array([ESC, 0x4d, 0x00]),        // 12×24 standard
  FONT_B: new Uint8Array([ESC, 0x4d, 0x01]),        // 9×17 smaller, more chars/line
  REVERSE_ON: new Uint8Array([GS, 0x42, 0x01]),     // White on black
  REVERSE_OFF: new Uint8Array([GS, 0x42, 0x00]),
  LINE_FEED: new Uint8Array([LF]),
  CUT: new Uint8Array([GS, 0x56, 0x00]),
  PARTIAL_CUT: new Uint8Array([GS, 0x56, 0x01]),
  UNDERLINE_ON: new Uint8Array([ESC, 0x2d, 0x01]),
  UNDERLINE_OFF: new Uint8Array([ESC, 0x2d, 0x00]),
  UNDERLINE_THICK: new Uint8Array([ESC, 0x2d, 0x02]),
  FEED_LINES: (n: number) => new Uint8Array([ESC, 0x64, n]),
}

const encoder = new TextEncoder()

class BluetoothPrinter {
  private device: BluetoothDevice | null = null
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null
  private connected = false

  // All known thermal printer service UUIDs
  private static ALL_SERVICE_UUIDS = [
    '000018f0-0000-1000-8000-00805f9b34fb',
    'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
    '49535343-fe7d-4ae5-8fa9-9fafd205e455',
    '0000ff00-0000-1000-8000-00805f9b34fb',
    '0000ffe0-0000-1000-8000-00805f9b34fb',
    '00001101-0000-1000-8000-00805f9b34fb',
    '0000fee7-0000-1000-8000-00805f9b34fb',
  ]

  // Find writable characteristic on a connected server
  private async findWritable(server: BluetoothRemoteGATTServer): Promise<boolean> {
    // Try known service UUIDs first
    for (const serviceUuid of BluetoothPrinter.ALL_SERVICE_UUIDS) {
      try {
        const service = await server.getPrimaryService(serviceUuid)
        const chars = await service.getCharacteristics()
        for (const char of chars) {
          if (char.properties.write || char.properties.writeWithoutResponse) {
            this.characteristic = char
            this.connected = true
            return true
          }
        }
      } catch { continue }
    }
    // Last resort: discover all services
    try {
      const services = await server.getPrimaryServices()
      for (const service of services) {
        try {
          const chars = await service.getCharacteristics()
          for (const char of chars) {
            if (char.properties.write || char.properties.writeWithoutResponse) {
              this.characteristic = char
              this.connected = true
              return true
            }
          }
        } catch { continue }
      }
    } catch {}
    return false
  }

  // Try reconnect to previously paired device (no picker)
  async reconnect(savedDeviceId?: string): Promise<boolean> {
    if (!savedDeviceId) return false
    try {
      // getDevices() returns previously authorized devices without showing picker
      if (!('getDevices' in navigator.bluetooth)) return false
      const devices = await navigator.bluetooth.getDevices()
      const saved = devices.find(d => d.id === savedDeviceId)
      if (!saved || !saved.gatt) return false

      // Listen for advertisement to reconnect
      this.device = saved
      const server = await saved.gatt.connect()
      const found = await this.findWritable(server)
      if (found) return true

      // Disconnect if no writable found
      saved.gatt.disconnect()
      return false
    } catch {
      return false
    }
  }

  // Connect with device picker (first time or reconnect failed)
  async connect(): Promise<boolean> {
    try {
      this.device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: BluetoothPrinter.ALL_SERVICE_UUIDS,
      })

      const server = await this.device.gatt!.connect()
      const found = await this.findWritable(server)
      if (!found) throw new Error('No writable characteristic found on this device')
      return true
    } catch (err: unknown) {
      console.error('Bluetooth connect error:', err)
      this.connected = false
      throw err
    }
  }

  // Smart connect: try reconnect first, fall back to picker
  async smartConnect(savedDeviceId?: string): Promise<boolean> {
    // If already connected, reuse
    if (this.connected && this.characteristic && this.device?.gatt?.connected) {
      return true
    }

    // Try reconnect to saved device
    if (savedDeviceId) {
      const reconnected = await this.reconnect(savedDeviceId)
      if (reconnected) return true
    }

    // Fall back to picker
    return this.connect()
  }

  getDeviceId(): string | null {
    return this.device?.id ?? null
  }

  async disconnect() {
    // Don't fully disconnect — keep device reference for reconnect
    this.connected = false
    this.characteristic = null
  }

  async fullDisconnect() {
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect()
    }
    this.connected = false
    this.device = null
    this.characteristic = null
  }

  isConnected(): boolean {
    return this.connected && !!this.characteristic
  }

  getDeviceName(): string | null {
    return this.device?.name ?? null
  }

  // Buffer for batching commands
  private buffer: Uint8Array[] = []
  private buffering = false

  startBatch() { this.buffering = true; this.buffer = [] }

  private addToBuffer(data: Uint8Array) {
    this.buffer.push(data)
  }

  async flushBatch() {
    if (!this.characteristic) throw new Error('Not connected')
    // Merge all buffered data into one array
    const totalLen = this.buffer.reduce((s, b) => s + b.length, 0)
    const merged = new Uint8Array(totalLen)
    let offset = 0
    for (const b of this.buffer) {
      merged.set(b, offset)
      offset += b.length
    }
    this.buffer = []
    this.buffering = false

    // Send in larger chunks for speed
    const CHUNK = 512
    for (let i = 0; i < merged.length; i += CHUNK) {
      const chunk = merged.slice(i, i + CHUNK)
      if (this.characteristic.properties.writeWithoutResponse) {
        await this.characteristic.writeValueWithoutResponse(chunk)
      } else {
        await this.characteristic.writeValueWithResponse(chunk)
      }
      // Smaller delay for larger chunks
      if (i + CHUNK < merged.length) await new Promise(r => setTimeout(r, 10))
    }
  }

  private async sendBytes(data: Uint8Array) {
    if (this.buffering) { this.addToBuffer(data); return }
    if (!this.characteristic) throw new Error('Not connected')
    const CHUNK = 512
    for (let i = 0; i < data.length; i += CHUNK) {
      const chunk = data.slice(i, i + CHUNK)
      if (this.characteristic.properties.writeWithoutResponse) {
        await this.characteristic.writeValueWithoutResponse(chunk)
      } else {
        await this.characteristic.writeValueWithResponse(chunk)
      }
      if (i + CHUNK < data.length) await new Promise(r => setTimeout(r, 10))
    }
  }

  async sendCommand(cmd: Uint8Array) {
    await this.sendBytes(cmd)
  }

  async printText(text: string) {
    await this.sendBytes(encoder.encode(text))
    await this.sendCommand(COMMANDS.LINE_FEED)
  }

  async printLine(text: string, bold = false, size: 'normal' | 'large' | 'double-height' | 'double-width' = 'normal') {
    if (bold) await this.sendCommand(COMMANDS.BOLD_ON)
    switch (size) {
      case 'large': await this.sendCommand(COMMANDS.FONT_LARGE); break
      case 'double-height': await this.sendCommand(COMMANDS.FONT_DOUBLE_HEIGHT); break
      case 'double-width': await this.sendCommand(COMMANDS.FONT_DOUBLE_WIDTH); break
      default: await this.sendCommand(COMMANDS.FONT_NORMAL)
    }
    await this.sendBytes(encoder.encode(text))
    await this.sendCommand(COMMANDS.LINE_FEED)
    if (bold) await this.sendCommand(COMMANDS.BOLD_OFF)
    await this.sendCommand(COMMANDS.FONT_NORMAL)
  }

  async printCentered(text: string, bold = false, size: 'normal' | 'large' = 'normal') {
    await this.sendCommand(COMMANDS.ALIGN_CENTER)
    await this.printLine(text, bold, size)
    await this.sendCommand(COMMANDS.ALIGN_LEFT)
  }

  async printDivider(char = '-', width = 32) {
    await this.printText(char.repeat(width))
  }

  async printKeyValue(key: string, value: string, width = 32) {
    const padding = width - key.length - value.length
    const line = key + ' '.repeat(Math.max(1, padding)) + value
    await this.printText(line)
  }

  async setFontB() {
    await this.sendCommand(COMMANDS.FONT_B)
  }

  async setFontA() {
    await this.sendCommand(COMMANDS.FONT_A)
  }

  async reverseOn() {
    await this.sendCommand(COMMANDS.REVERSE_ON)
  }

  async reverseOff() {
    await this.sendCommand(COMMANDS.REVERSE_OFF)
  }

  async underlineOn(thick = false) {
    await this.sendCommand(thick ? COMMANDS.UNDERLINE_THICK : COMMANDS.UNDERLINE_ON)
  }

  async underlineOff() {
    await this.sendCommand(COMMANDS.UNDERLINE_OFF)
  }

  async printReverse(text: string, bold = false, size: 'normal' | 'large' | 'double-height' = 'normal') {
    await this.sendCommand(COMMANDS.REVERSE_ON)
    await this.printLine(` ${text} `, bold, size)
    await this.sendCommand(COMMANDS.REVERSE_OFF)
  }

  async printReverseCentered(text: string, bold = false, size: 'normal' | 'large' | 'double-height' = 'normal') {
    await this.sendCommand(COMMANDS.ALIGN_CENTER)
    await this.sendCommand(COMMANDS.REVERSE_ON)
    await this.printLine(` ${text} `, bold, size)
    await this.sendCommand(COMMANDS.REVERSE_OFF)
    await this.sendCommand(COMMANDS.ALIGN_LEFT)
  }

  async printUnderlined(text: string, bold = false) {
    await this.sendCommand(COMMANDS.UNDERLINE_ON)
    if (bold) await this.sendCommand(COMMANDS.BOLD_ON)
    await this.sendBytes(encoder.encode(text))
    await this.sendCommand(COMMANDS.LINE_FEED)
    if (bold) await this.sendCommand(COMMANDS.BOLD_OFF)
    await this.sendCommand(COMMANDS.UNDERLINE_OFF)
  }

  async printQRCode(content: string, size = 6) {
    // QR Code: GS ( k - Model 2
    const data = encoder.encode(content)
    const len = data.length + 3

    // Select model 2
    await this.sendBytes(new Uint8Array([GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]))
    // Set size (1-16)
    await this.sendBytes(new Uint8Array([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, size]))
    // Set error correction level (L)
    await this.sendBytes(new Uint8Array([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x30]))
    // Store data
    const storeCmd = new Uint8Array([GS, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 0x31, 0x50, 0x30, ...data])
    await this.sendBytes(storeCmd)
    // Print QR code
    await this.sendBytes(new Uint8Array([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]))
  }

  async feedLines(n = 3) {
    await this.sendCommand(COMMANDS.FEED_LINES(n))
  }

  async cut() {
    await this.feedLines(3)
    await this.sendCommand(COMMANDS.PARTIAL_CUT)
  }

  async init() {
    await this.sendCommand(COMMANDS.INIT)
  }
}

export { BluetoothPrinter, COMMANDS }
