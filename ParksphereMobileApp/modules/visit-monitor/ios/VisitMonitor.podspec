Pod::Spec.new do |s|
  s.name           = 'VisitMonitor'
  s.version        = '1.0.0'
  s.summary        = 'iOS CLVisit monitoring (native arrival/departure detection)'
  s.description    = 'Wraps CLLocationManager.startMonitoringVisits to emit arrival/departure events that wake a suspended/terminated app.'
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
