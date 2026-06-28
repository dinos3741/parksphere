Pod::Spec.new do |s|
  s.name           = 'CarAudio'
  s.version        = '1.0.0'
  s.summary        = 'Detect car-audio (Bluetooth HFP/A2DP / CarPlay) connection via AVAudioSession'
  s.description    = 'Reads the AVAudioSession output route to detect connection to the car.'
  s.author         = 'Parksphere'
  s.homepage       = 'https://github.com/dinos3741/parksphere'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
