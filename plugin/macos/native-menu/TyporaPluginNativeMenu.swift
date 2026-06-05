import AppKit
import ApplicationServices
import Foundation

final class RpcClient {
    let connectionFile: String
    var port: Int = 0
    var token: String = ""

    init(connectionFile: String) {
        self.connectionFile = connectionFile
        reloadConnection()
    }

    func reloadConnection() {
        guard let data = FileManager.default.contents(atPath: connectionFile),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return
        }
        port = json["port"] as? Int ?? port
        token = json["token"] as? String ?? token
    }

    func call(_ method: String, params: [String: Any] = [:]) -> [String: Any]? {
        if port == 0 || token.isEmpty {
            reloadConnection()
        }
        guard port > 0, !token.isEmpty else {
            return nil
        }

        guard let url = URL(string: "http://127.0.0.1:\(port)/rpc") else {
            return nil
        }

        let payload: [String: Any] = [
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params,
        ]

        guard let body = try? JSONSerialization.data(withJSONObject: payload) else {
            return nil
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let semaphore = DispatchSemaphore(value: 0)
        var result: [String: Any]?

        URLSession.shared.dataTask(with: request) { data, _, _ in
            defer { semaphore.signal() }
            guard let data,
                  let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  object["error"] == nil else {
                return
            }
            result = object["result"] as? [String: Any]
        }.resume()

        _ = semaphore.wait(timeout: .now() + 2)
        return result
    }
}

final class NativeMenuAgent: NSObject {
    let rpc: RpcClient
    let triggerModifier: CGEventFlags
    var eventTap: CFMachPort?

    init(pluginRoot: String, triggerModifier: String) {
        let connectionFile = "\(pluginRoot)/plugin/macos/helper/connection.json"
        self.rpc = RpcClient(connectionFile: connectionFile)
        self.triggerModifier = NativeMenuAgent.flag(for: triggerModifier)
        super.init()
    }

    static func flag(for value: String) -> CGEventFlags {
        switch value.lowercased() {
        case "command", "cmd", "meta":
            return .maskCommand
        case "control", "ctrl":
            return .maskControl
        case "shift":
            return .maskShift
        default:
            return .maskAlternate
        }
    }

    func start() {
        NSApplication.shared.setActivationPolicy(.accessory)

        let promptKey = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        let options = [promptKey: true] as CFDictionary
        if !AXIsProcessTrustedWithOptions(options) {
            fputs("[typora-plugin-native-menu] Accessibility permission is required.\n", stderr)
        }

        if !installEventTap() {
            fputs("[typora-plugin-native-menu] Failed to create event tap; waiting for Accessibility permission.\n", stderr)
            Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { timer in
                if self.installEventTap() {
                    timer.invalidate()
                }
            }
        }

        RunLoop.main.run()
    }

    func installEventTap() -> Bool {
        if eventTap != nil {
            return true
        }

        let mask = CGEventMask(1 << CGEventType.rightMouseDown.rawValue)
        let refcon = Unmanaged.passUnretained(self).toOpaque()
        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .defaultTap,
            eventsOfInterest: mask,
            callback: eventTapCallback,
            userInfo: refcon
        ) else {
            return false
        }

        eventTap = tap
        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        print("[typora-plugin-native-menu] listening; trigger is Option+RightClick by default")
        return true
    }

    func handleEvent(type: CGEventType, event: CGEvent) -> Unmanaged<CGEvent>? {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            if let eventTap {
                CGEvent.tapEnable(tap: eventTap, enable: true)
            }
            return Unmanaged.passUnretained(event)
        }

        guard type == .rightMouseDown else {
            return Unmanaged.passUnretained(event)
        }
        guard isTyporaFrontmost() else {
            return Unmanaged.passUnretained(event)
        }
        guard event.flags.contains(triggerModifier) else {
            return Unmanaged.passUnretained(event)
        }

        DispatchQueue.main.async {
            self.showMenu()
        }
        return nil
    }

    func isTyporaFrontmost() -> Bool {
        let bundleID = NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? ""
        return bundleID == "abnerworks.Typora"
    }

    func showMenu() {
        guard let result = rpc.call("nativeMenu.get"),
              let items = result["menu"] as? [[String: Any]],
              !items.isEmpty else {
            return
        }

        let menu = buildMenu(items)
        let point = NSEvent.mouseLocation
        let window = NSWindow(
            contentRect: NSRect(x: point.x, y: point.y, width: 1, height: 1),
            styleMask: .borderless,
            backing: .buffered,
            defer: false
        )
        window.isOpaque = false
        window.backgroundColor = .clear
        window.level = .popUpMenu

        let view = NSView(frame: NSRect(x: 0, y: 0, width: 1, height: 1))
        window.contentView = view
        window.orderFront(nil)
        menu.popUp(positioning: nil, at: NSPoint(x: 0, y: 0), in: view)
        window.close()
    }

    func buildMenu(_ items: [[String: Any]]) -> NSMenu {
        let menu = NSMenu()
        menu.autoenablesItems = false

        for item in items {
            if item["type"] as? String == "separator" {
                menu.addItem(.separator())
                continue
            }

            let label = item["label"] as? String ?? ""
            let id = item["id"] as? String ?? ""
            let menuItem = NSMenuItem(title: label, action: #selector(menuItemSelected(_:)), keyEquivalent: "")
            menuItem.target = self
            menuItem.representedObject = id
            menuItem.isEnabled = item["enabled"] as? Bool ?? true

            if let children = item["children"] as? [[String: Any]], !children.isEmpty {
                menuItem.submenu = buildMenu(children)
            }

            menu.addItem(menuItem)
        }

        return menu
    }

    @objc func menuItemSelected(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String, !id.isEmpty else {
            return
        }
        _ = rpc.call("nativeMenu.dispatch", params: ["id": id])
    }
}

private let eventTapCallback: CGEventTapCallBack = { _, type, event, refcon in
    guard let refcon else {
        return Unmanaged.passUnretained(event)
    }
    let agent = Unmanaged<NativeMenuAgent>.fromOpaque(refcon).takeUnretainedValue()
    return agent.handleEvent(type: type, event: event)
}

let home = FileManager.default.homeDirectoryForCurrentUser.path
let pluginRoot = ProcessInfo.processInfo.environment["TYPORA_PLUGIN_ROOT"]
    ?? "\(home)/Library/Application Support/abnerworks.Typora/plugins/typora_plugin"
let trigger = ProcessInfo.processInfo.environment["TYPORA_NATIVE_MENU_TRIGGER"] ?? "option"

NativeMenuAgent(pluginRoot: pluginRoot, triggerModifier: trigger).start()
