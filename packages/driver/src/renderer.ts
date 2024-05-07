import {ImageRepository} from "./image";

const vertexShaderSource = `
attribute vec2 a_Position;
attribute vec2 a_TexCoord;
varying vec2 v_TexCoord;
uniform vec2 u_Resolution;

void main(void) {
  vec2 zeroToOne = a_Position / u_Resolution;
  vec2 zeroToTwo = zeroToOne * 2.0 - 1.0;
  vec2 clipSpace = zeroToTwo * vec2(1, -1);
  gl_Position = vec4(clipSpace, 0, 1);
  v_TexCoord = a_TexCoord;
}
`;

const fillFragmentShaderSource = `
precision mediump float;
uniform vec4 u_Color;
void main(void) {
    gl_FragColor = u_Color;
}
`;

const textureFragmentShaderSource = `
precision mediump float;
uniform sampler2D u_Texture;
varying vec2 v_TexCoord;
void main(void) {
    gl_FragColor = texture2D(u_Texture, v_TexCoord);
}
`;

class ShaderProgram<T> {
    private readonly gl: WebGLRenderingContext;
    private readonly program: WebGLProgram;
    private readonly locations: T;

    constructor(gl: WebGLRenderingContext, vertexShaderSource: string, fragmentShaderSource: string, bindLocations: (_: WebGLProgram) => T) {
        this.gl = gl;

        const vertexShader = this.createShader(gl.VERTEX_SHADER, vertexShaderSource);
        const fragmentShader = this.createShader(gl.FRAGMENT_SHADER, fragmentShaderSource);

        const program = gl.createProgram();
        if (!program) throw new Error("Failed to create program");
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            throw new Error("Failed to link program: " + gl.getProgramInfoLog(program));
        }

        this.locations = bindLocations(program);

        this.program = program;
    }

    use(set: (locations: T) => void) {
        this.gl.useProgram(this.program);
        set(this.locations);
    }

    private createShader(type: number, source: string): WebGLShader {
        const gl = this.gl;

        const shader = gl.createShader(type);
        if (!shader) throw new Error("Failed to create shader");
        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            throw new Error("Failed to compile shader: " + gl.getShaderInfoLog(shader));
        }

        return shader;
    }
}

class Canvas {
    private readonly gl: WebGLRenderingContext;

    private readonly fillProgram: ShaderProgram<{ position: number, resolution: WebGLUniformLocation, color: WebGLUniformLocation }>;
    private readonly textureProgram: ShaderProgram<{ position: number, texCoord: number, resolution: WebGLUniformLocation }>;

    private readonly positionBuffer: WebGLBuffer;
    private readonly texCoordBuffer: WebGLBuffer;

    get element(): HTMLCanvasElement {
        return this._element;
    }
    private readonly _element: HTMLCanvasElement;

    constructor(width: number, height: number) {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        // canvas.style.position = 'absolute';
        this._element = canvas;

        const gl = canvas.getContext("webgl");
        if (!gl) throw new Error("Failed to get WebGL context");
        this.gl = gl;

        this.fillProgram = new ShaderProgram(gl, vertexShaderSource, fillFragmentShaderSource, (program) => {
            const position = gl.getAttribLocation(program, "a_Position");
            if (position < 0) throw new Error("Failed to get attribute location");

            const resolution = gl.getUniformLocation(program, "u_Resolution");
            if (!resolution) throw new Error("Failed to get uniform location");

            const color = gl.getUniformLocation(program, "u_Color");
            if (!color) throw new Error("Failed to get uniform location");

            return {
                position,
                resolution,
                color,
            };
        });

        this.textureProgram = new ShaderProgram(gl, vertexShaderSource, textureFragmentShaderSource, (program) => {
            const position = gl.getAttribLocation(program, "a_Position");
            if (position < 0) throw new Error("Failed to get attribute location");

            const texCoord = gl.getAttribLocation(program, "a_TexCoord");
            if (texCoord < 0) throw new Error("Failed to get attribute location");

            const resolution = gl.getUniformLocation(program, "u_Resolution");
            if (!resolution) throw new Error("Failed to get uniform location");

            return {
                position,
                texCoord,
                resolution,
            };
        });

        const positionBuffer = gl.createBuffer();
        if (!positionBuffer) throw new Error("Failed to create vertex buffer");
        this.positionBuffer = positionBuffer;

        const texCoordBuffer = gl.createBuffer();
        if (!texCoordBuffer) throw new Error("Failed to create texture coordinate buffer");
        this.texCoordBuffer = texCoordBuffer;

        // Set up the viewport
        gl.viewport(0, 0, width, height);
        this.fillProgram.use(({ resolution}) => {
            gl.uniform2f(resolution, width, height)
        });
        this.textureProgram.use(({ resolution }) => {
            gl.uniform2f(resolution, width, height)
        });
    }

    fillRect(coords: number[], color0: number[]) {
        const gl = this.gl;
        this.fillProgram.use(({ position, color }) => {
            gl.enableVertexAttribArray(position);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(coords), gl.STATIC_DRAW);
            gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
            gl.uniform4fv(color, color0);

            gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);

            gl.disableVertexAttribArray(position);
        });
    }

    drawImage(coords: number[], texCoords: number[], bitmap: ImageBitmap) {
        const gl = this.gl;
        this.textureProgram.use(({ position, texCoord }) => {
            // Assign the texture
            const texture = gl.createTexture();
            if (!texture) throw new Error("Failed to create texture");
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

            gl.enableVertexAttribArray(position);
            gl.enableVertexAttribArray(texCoord);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(coords), gl.STATIC_DRAW);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texCoords), gl.STATIC_DRAW);
            gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
            gl.vertexAttribPointer(texCoord, 2, gl.FLOAT, false, 0, 0);

            gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
        });
    }
}

export class Renderer {
    private root: HTMLDivElement;
    private canvas: Canvas;
    private currentColor: number[] = [0, 0, 0, 0];
    private isDirty = false;
    private readonly imageRepo: ImageRepository;

    constructor(root: HTMLDivElement, imageRepo: ImageRepository) {
        this.root = root;
        this.imageRepo = imageRepo;

        this.canvas = new Canvas(1920, 1080);
        this.root.appendChild(this.canvas.element);
    }

    invalidate() {
        this.isDirty = true;
    }

    begin() {
        // this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    setColor(r: number, g: number, b: number, a: number) {
        this.currentColor = [r / 255, g / 255, b / 255, a / 255];
    }

    drawImage(handle: number, x: number, y: number, width: number, height: number, s1: number, t1: number, s2: number, t2: number) {
        if (handle === 0) {
            this.canvas.fillRect([x, y, x + width, y, x + width, y + height, x, y + height], this.currentColor);
        } else {
            const image = this.imageRepo.get(handle);
            if (image && image.bitmap) {
                // this.canvas.drawImage([x, y, x + width, y, x + width, y + height, x, y + height], [s1, t1, s2, t2], image.bitmap);
            } else {
                this.canvas.fillRect([x, y, x + width, y, x + width, y + height, x, y + height], [1, 0, 1, 0.5]);
            }
        }
    }
}
