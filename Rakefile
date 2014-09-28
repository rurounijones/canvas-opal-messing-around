require 'opal'
require 'opal-jquery'

desc "Build our app to map.js"
task :build do
  env = Opal::Environment.new
  env.append_path "app"

  File.open("map.js", "w+") do |out|
    out << env["map"].to_s
  end
end
