require 'opal'

x = (0..3).map do |n|
      n * n * n
    end.reduce(:+)
puts x
