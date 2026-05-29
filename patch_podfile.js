const fs = require('fs');
const path = require('path');

const podfilePath = path.join(__dirname, 'ParksphereMobileApp', 'ios', 'Podfile');

if (!fs.existsSync(podfilePath)) {
    console.error('Podfile not found at', podfilePath);
    process.exit(1);
}

let content = fs.readFileSync(podfilePath, 'utf8');

const settingsBlock = `
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.1'
        
        # 🚀 Granular standard selection
        if target.name.include?('fmt')
          # fmt library has issues with C++20 consteval in some Clang versions
          config.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'gnu++17'
        else
          # React Native 0.81+ requires C++20
          config.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++20'
        end

        config.build_settings['OTHER_CPLUSPLUSFLAGS'] = [
          '$(inherited)',
          '-DFMT_ENFORCE_COMPILE_STRING'
        ]
      end
    end
`;

// Remove any existing manual settings block we might have added
content = content.replace(/installer\.pods_project\.targets\.each[\s\S]+?end\s+end\s+end/g, 'end');

const marker = '    react_native_post_install(';
if (content.includes(marker)) {
    const parts = content.split('  post_install do |installer|');
    if (parts.length > 1) {
        const postInstallPart = parts[1];
        const endOfBlock = postInstallPart.indexOf('  end');
        const newPostInstall = postInstallPart.slice(0, endOfBlock) + settingsBlock + postInstallPart.slice(endOfBlock);
        content = parts[0] + '  post_install do |installer|' + newPostInstall;
    }
}

fs.writeFileSync(podfilePath, content);
console.log('Successfully patched Podfile with granular C++ standards.');
