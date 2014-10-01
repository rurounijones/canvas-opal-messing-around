require 'opal'
require 'opal-jquery'
require 'systems'

class Grid
  attr_reader :height, :width, :canvas, :context, :max_x, :max_y

  CELL_HEIGHT = 4;
  CELL_WIDTH  = 4;

  def initialize
    @height  = `$(window).height()`
    @width   = `$(window).width()`
    @height  = `4000`
    @width   = `4000`
    @canvas  = `document.getElementById(#{canvas_id})`
    @context = `#{canvas}.getContext('2d')`
    @max_x   = (height / CELL_HEIGHT).floor
    @max_y   = (width / CELL_WIDTH).floor
  end

  def draw_canvas
    `#{canvas}.width  = #{width}`
    `#{canvas}.height = #{height}`


    #x = 0.5
    #until x >= width do
    #  `#{context}.moveTo(#{x}, 0)`
    #  `#{context}.lineTo(#{x}, #{height})`
    #  x += CELL_WIDTH
    #end

    #y = 0.5
    #until y >= height do
    #  `#{context}.moveTo(0, #{y})`
    #  `#{context}.lineTo(#{width}, #{y})`
    #  y += CELL_HEIGHT
    #end
    # `#{context}.strokeStyle = "#eee"`
    # `#{context}.stroke()`

    `#{context}.fillStyle = "#fff"`
    `#{context}.font = "20pt Arial"`
    `#{context}.fillText('Map of the Inner Sphere Circa 3025', #{30}, #{30})`
    `#{context}.font = "10pt Arial"`

  end

  def canvas_id
    'mapCanvas'
  end

  def draw_planet(name,x,y, faction)
    #x = (x *= CELL_WIDTH / 2) + @height / 2;
    #y = (y *= CELL_HEIGHT / 2) * -1.0 + @width / 2;
    x = x + @height / 2;
    y = y * -1.0 + @width / 2;
    if ["Tharkad", "Terra", "New Avalon", "Luthien", "Atreus (FWL)", "Sian", "Strana Mechty"].include?(name)
      `#{context}.fillStyle = "#fff"`
      `#{context}.fillText(#{name}, #{x.floor+5}, #{y.floor+6})`
    end

    if faction[0..1] == "DC"
      `#{context}.fillStyle = "#f00"`
    elsif faction[0..1] == "FS"
      `#{context}.fillStyle = "#ffff00"`
    elsif faction[0..1] == "LC"
      `#{context}.fillStyle = "#2e64fe"`
    elsif faction[0..1] == "CC"
      `#{context}.fillStyle = "#01df3a"`
    elsif faction[0..2] == "FWL"
      `#{context}.fillStyle = "#a901db"`
    else
      `#{context}.fillStyle = "#fff"`
    end
    `#{context}.fillRect(#{x.floor+1}, #{y.floor+1}, #{CELL_WIDTH-1}, #{CELL_HEIGHT-1})`
  end

end

grid = Grid.new
grid.draw_canvas
SYSTEMS.each do |p|
  grid.draw_planet(p[0], p[1], p[2], p[3])
end
