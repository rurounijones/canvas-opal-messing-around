require 'opal'
require 'opal-jquery'
require 'systems'

class Map
  attr_accessor :height, :width, :canvas, :context, :x, :y, :dragging, :zoom

  def initialize
    @height  = `$(window).height() * 0.9`
    @width   = `$(window).width() * 0.9`
    @canvas  = `document.getElementById(#{canvas_id})`
    @context = `#{canvas}.getContext('2d')`
    @x = @width / 2
    @y = (@height / 2) * -1.0
    @dragging = false
    @drag_start_x = 0
    @drag_start_y = 0
    @zoom = 1
    Element.find("##{canvas_id}").on :mousedown do |event|
      @drag_start_x = event[:clientX] - `#{rect}.left`
      @drag_start_y = event[:clientY] - `#{rect}.top`
      @dragging = true
    end
    Element.find("##{canvas_id}").on :mousemove do |event|

      if @dragging
        drag_end_x = event[:clientX] - `#{rect}.left`
        drag_end_y = event[:clientY] - `#{rect}.top`


        x_arr = [@drag_start_x, drag_end_x]
        x_diff = (x_arr.min..x_arr.max).size

        y_arr = [@drag_start_y, drag_end_y]
        y_diff = (y_arr.min..y_arr.max).size

        if drag_end_x > @drag_start_x
          @x = @x + x_diff
        elsif drag_end_x < @drag_start_x
          @x = @x - x_diff
        end

        if drag_end_y < @drag_start_y
          @y = @y + y_diff
        elsif drag_end_x > @drag_start_y
          @y = @y - y_diff
        end
        @drag_start_x = drag_end_x
        @drag_start_y = drag_end_y
        draw_planets
      end
    end

    Element.find("##{canvas_id}").on :mouseup do |event|
      @dragging = false
    end

    Element.find("##{canvas_id}").on :mouseout do |event|
      @dragging = false
    end

    Element.find("##{canvas_id}").on :mousewheel do |event|
      @mag = event[:deltaY]
      if @mag > 0
        @zoom = @zoom * 2
        @x = @x / 2
        @y= @y / 2
      elsif @zoom >= 1
        @zoom = @zoom / 2
        @x = @x * 2
        @y = @y * 2
      end
      draw_planets
    end
  end

  def rect
    @rect = `#{canvas}.getBoundingClientRect();`
  end

  def draw_canvas
    `#{canvas}.width  = #{width}`
    `#{canvas}.height = #{height}`

    `#{context}.fillStyle = "#fff"`
    `#{context}.font = "10pt Arial"`
    draw_planets
  end

  def canvas_id
    'mapCanvas'
  end

  def draw_planets
    `#{context}.clearRect(0,0, #{canvas}.width, #{canvas}.height)`
    SYSTEMS.each do |p|
      draw_planet(p[0], p[1], p[2], p[3])
    end
  end

  def draw_planet(name, system_x, system_y, faction)
    system_x = (system_x + x) * zoom
    system_y = ((system_y + y) * -1.0) * zoom

    if system_x > 0 && system_x < self.width && system_y > 0 && system_y < self.height #Only if the systems are in the viewport
      if ["Tharkad", "Terra", "New Avalon", "Luthien", "Atreus (FWL)", "Sian", "Strana Mechty"].include?(name) || @zoom > 3
        `#{context}.fillStyle = "#fff"`
        `#{context}.fillText(#{name}, #{system_x.floor + 5 + @zoom}, #{system_y.floor + 6 + @zoom})`
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
      `#{context}.fillRect(#{system_x.floor + 1}, #{system_y.floor + 1}, #{self.zoom}, #{self.zoom})`
    end
  end

end

map = Map.new
map.draw_canvas
