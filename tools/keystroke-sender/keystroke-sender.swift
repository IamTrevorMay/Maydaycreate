// Mayday Keystroke Sender — posts CGEvents to simulate keyboard shortcuts
// Usage: keystroke-sender <keyCode> [--cmd] [--alt] [--shift] [--ctrl]

import Foundation
import CoreGraphics

guard CommandLine.arguments.count >= 2,
      let keyCode = UInt16(CommandLine.arguments[1]) else {
    fputs("Usage: keystroke-sender <keyCode> [--cmd] [--alt] [--shift] [--ctrl]\n", stderr)
    exit(1)
}

let args = Set(CommandLine.arguments.dropFirst(2))

var flags = CGEventFlags()
if args.contains("--cmd")   { flags.insert(.maskCommand) }
if args.contains("--alt")   { flags.insert(.maskAlternate) }
if args.contains("--shift") { flags.insert(.maskShift) }
if args.contains("--ctrl")  { flags.insert(.maskControl) }

let src = CGEventSource(stateID: CGEventSourceStateID.hidSystemState)

if let down = CGEvent(keyboardEventSource: src, virtualKey: CGKeyCode(keyCode), keyDown: true) {
    down.flags = flags
    down.post(tap: CGEventTapLocation.cghidEventTap)
}

usleep(50000) // 50ms between down and up

if let up = CGEvent(keyboardEventSource: src, virtualKey: CGKeyCode(keyCode), keyDown: false) {
    up.flags = flags
    up.post(tap: CGEventTapLocation.cghidEventTap)
}
