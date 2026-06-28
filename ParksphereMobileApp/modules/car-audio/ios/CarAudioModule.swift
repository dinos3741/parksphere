import ExpoModulesCore
import AVFoundation

// Detects whether the iPhone is connected to the car's audio system.
//
// AVAudioSession port types used:
//   • .bluetoothHFP — Hands-Free Profile (calling / voice). Registered by car stereos and
//     speakerphones the moment the phone pairs. Headphones (AirPods, over-ear) do NOT register
//     as HFP in normal use — they appear only as A2DP, which we intentionally omit.
//   • .carAudio — CarPlay (wired or wireless).
//
// Detection priority (firstCarPort):
//   1. currentRoute.outputs — car is actively receiving audio (most reliable).
//   2. currentRoute.inputs  — car microphone is the active input; iOS keeps HFP in the input
//      route even when audio output reverts to the built-in speaker (no call/music playing).
//      This is the primary idle-BT detection path for cars like Audi TT 2019.
//   3. availableInputs      — last resort; only works if the audio session is configured with
//      .allowBluetooth (returns nil otherwise).
// Sticky state: we latch connected=true on newDeviceAvailable and clear it only on
// oldDeviceUnavailable when routeHasCar() (checking both ports) confirms the car is gone.
//
// `isCarConnected()` returns { connected, deviceName?, deviceUID? } so the JS layer can
// match the connected port against the user's confirmed car device.
public class CarAudioModule: Module {
  private var routeObserver: NSObjectProtocol?
  private var sticky: Bool = false
  private var stickyDeviceName: String? = nil
  private var stickyDeviceUID: String? = nil

  public func definition() -> ModuleDefinition {
    Name("CarAudio")

    Events("onCarConnectionChange")

    AsyncFunction("isCarConnected") { () -> [String: Any] in
      let port = self.firstCarPort()
      let connected = self.sticky || port != nil
      var result: [String: Any] = ["connected": connected]
      if let name = port?.portName ?? self.stickyDeviceName { result["deviceName"] = name }
      if let uid = port?.uid ?? self.stickyDeviceUID { result["deviceUID"] = uid }
      return result
    }

    OnStartObserving {
      // Add .allowBluetooth so that availableInputs enumerates HFP devices even when no
      // audio is actively routed to the car. We use .mixWithOthers to avoid interrupting
      // any audio already in progress. This is required by Apple: availableInputs returns
      // nil unless the session is configured with .allowBluetooth.
      let session = AVAudioSession.sharedInstance()
      try? session.setCategory(
        .playAndRecord,
        options: [.allowBluetooth, .mixWithOthers, .defaultToSpeaker]
      )
      if let port = self.firstCarPort() {
        self.sticky = true
        self.stickyDeviceName = port.portName
        self.stickyDeviceUID = port.uid
      }
      self.routeObserver = NotificationCenter.default.addObserver(
        forName: AVAudioSession.routeChangeNotification,
        object: nil,
        queue: .main
      ) { [weak self] notification in
        guard let self = self else { return }
        self.handleRouteChange(notification)
      }
    }

    OnStopObserving {
      if let observer = self.routeObserver {
        NotificationCenter.default.removeObserver(observer)
        self.routeObserver = nil
      }
    }
  }

  private func handleRouteChange(_ notification: Notification) {
    guard
      let info = notification.userInfo,
      let reasonValue = info[AVAudioSessionRouteChangeReasonKey] as? UInt,
      let reason = AVAudioSession.RouteChangeReason(rawValue: reasonValue)
    else { return }

    switch reason {
    case .newDeviceAvailable:
      guard let port = firstCarPort() else { return }
      sticky = true
      stickyDeviceName = port.portName
      stickyDeviceUID = port.uid
      sendEvent("onCarConnectionChange", [
        "connected": true,
        "deviceName": port.portName,
        "deviceUID": port.uid
      ])

    case .oldDeviceUnavailable:
      guard
        let prev = info[AVAudioSessionRouteChangePreviousRouteKey] as? AVAudioSessionRouteDescription,
        // Check both output AND input ports in the previous route — HFP may only appear
        // as an input (car mic) if audio output had already reverted to built-in.
        let prevCar = (prev.outputs + prev.inputs).first(where: { CarAudioModule.isCarPort($0.portType) }),
        !routeHasCar()
      else { return }
      sticky = false
      stickyDeviceName = nil
      stickyDeviceUID = nil
      sendEvent("onCarConnectionChange", [
        "connected": false,
        "deviceName": prevCar.portName,
        "deviceUID": prevCar.uid
      ])

    default:
      break
    }
  }

  private func firstCarPort() -> AVAudioSessionPortDescription? {
    let session = AVAudioSession.sharedInstance()
    // 1. Active output: most reliable when audio is actively routed to car.
    if let output = session.currentRoute.outputs.first(where: { CarAudioModule.isCarPort($0.portType) }) {
      return output
    }
    // 2. Active input (car microphone): when HFP is connected but nothing is playing, iOS
    //    routes audio output back to the built-in speaker but keeps the HFP microphone in
    //    currentRoute.inputs. This is the idle-BT detection path and requires no session
    //    configuration changes.
    if let input = session.currentRoute.inputs.first(where: { CarAudioModule.isCarPort($0.portType) }) {
      return input
    }
    // 3. Available inputs: only works if the host app's audio session is configured with
    //    .allowBluetooth (returns nil otherwise per Apple docs).
    return session.availableInputs?.first { CarAudioModule.isCarPort($0.portType) }
  }

  private func routeHasCar() -> Bool {
    let session = AVAudioSession.sharedInstance()
    // Check both ports: output reverts to built-in when nothing is playing, but the HFP
    // microphone (input) often stays — checking both prevents premature sticky clear.
    return session.currentRoute.outputs.contains { CarAudioModule.isCarPort($0.portType) } ||
           session.currentRoute.inputs.contains { CarAudioModule.isCarPort($0.portType) }
  }

  private static func isCarPort(_ port: AVAudioSession.Port) -> Bool {
    // Deliberately excludes .bluetoothA2DP (stereo streaming) — used by headphones too.
    return port == .bluetoothHFP || port == .carAudio
  }
}
