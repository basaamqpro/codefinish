

import tkinter as tk

root = tk.Tk()
root.title("Square + Rotated Text")

canvas = tk.Canvas(root, width=1000, height=500, bg="white")
canvas.pack()

# ✅ Proper square
square = canvas.create_rectangle(50, 50, 100, 100, fill="red")

# ✅ Rotated text (same canvas!)
text = canvas.create_text(
    300, 150,
    text="Hello World",
    angle=45,
    font=("Arial", 20),
    fill="black"
)

distance = 10
step = 2
angleC = 0
def animate(event=None):
    global distance
    global angleC
    print("Distance travelled up:", distance)
    angleC = angleC + step
    canvas.itemconfigure(text, angle=distance)
    if distance > 100:
        canvas.itemconfig(square, fill="orange")
        canvas.move(square, step, 0)
    else:
        canvas.itemconfig(square, fill="black")
        canvas.move(square, -step, 0)
        distance += step

    root.after(200, animate)

# Click square to start animation
canvas.tag_bind(square, "<Button-1>", animate)

root.mainloop()