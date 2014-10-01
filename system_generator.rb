require 'csv'

planets = []
CSV.foreach("systems.csv") do |row|
  planets << row
end

File.open("app/systems.rb", "w") do |f|
  f << "systems =[ "
  planets.each do |p|
    f << "  [\"#{p[0]}\", #{p[1]}, #{p[2]}, \"#{p[3]}\"],\n"
  end
  f << "]"
end
