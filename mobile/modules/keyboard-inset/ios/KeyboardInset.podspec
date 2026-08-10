Pod::Spec.new do |s|
  s.name           = 'KeyboardInset'
  s.version        = '0.1.0'
  s.summary        = 'Native IME-inset-driven container for the chat composer.'
  s.description    = 'Glues the chat surface to the soft keyboard via WindowInsetsAnimation on Android. iOS is a passthrough; iOS keyboard motion stays with the JS driven-height transform.'
  s.author         = ''
  s.homepage       = 'https://github.com/witoh/mobile'
  s.platforms      = {
    :ios => '15.1',
    :tvos => '15.1'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
