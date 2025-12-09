namespace Digitaljs {
    export type FilePosition = {
        line: number,
        column: number
    };

    export type SourcePosition = {
        name: string,
        from: FilePosition,
        to: FilePosition
    };

    export type MemReadPort = {
        clock_polarity?: boolean,
        enable_polarity?: boolean,
        arst_polarity?: boolean,
        srst_polarity?: boolean,
        enable_srst?: boolean,
        transparent?: boolean | boolean[],
        collision?: boolean | boolean[],
        init_value?: string,
        arst_value?: string,
        srst_value?: string
    };

    export type MemWritePort = {
        clock_polarity?: boolean,
        enable_polarity?: boolean,
        no_bit_enable?: boolean
    };

    export type Device = {
        type: string,
        source_positions?: SourcePosition[],
        [key: string]: any
    };

    export type Port = {
        id: string,
        port: string
    };

    export type Connector = {
        from: Port,
        to: Port,
        name?: string,
        source_positions?: SourcePosition[]
    };

    export type Module = {
        devices: { [key: string]: Device },
        connectors: Connector[]
    };

    export type TopModule = Module & {
        subcircuits: { [key: string]: Module }
    };
};

namespace Yosys {

    export const ConstChars = ["0", "1", "x", "z"] as const;

    export type BitChar = (typeof ConstChars)[number];

    export type Bit = number | BitChar;

    export type BitVector = Bit[];

    export type Port = {
        direction: 'input' | 'output' | 'inout',
        bits: any
    };

    export type Parameters = {
        WIDTH?: JsonConstant,
        A_WIDTH?: JsonConstant,
        B_WIDTH?: JsonConstant,
        S_WIDTH?: JsonConstant,
        Y_WIDTH?: JsonConstant,
        A_SIGNED?: JsonConstant,
        B_SIGNED?: JsonConstant,
        CLK_POLARITY?: JsonConstant,
        EN_POLARITY?: JsonConstant,
        ARST_POLARITY?: JsonConstant,
        ARST_VALUE: JsonConstant,
        CTRL_IN_WIDTH?: JsonConstant,
        CTRL_OUT_WIDTH?: JsonConstant,
        TRANS_NUM?: JsonConstant,
        STATE_NUM?: JsonConstant,
        STATE_NUM_LOG2?: JsonConstant,
        STATE_RST?: JsonConstant,
        RD_PORTS?: JsonConstant,
        WR_PORTS?: JsonConstant,
        RD_CLK_POLARITY?: JsonConstant,
        RD_CLK_ENABLE?: JsonConstant,
        RD_CLK_TRANSPARENT?: JsonConstant,
        WR_CLK_POLARITY?: JsonConstant,
        WR_CLK_ENABLE?: JsonConstant,
        [key: string]: any
    };

    export type JsonConstant = number | string;

    export type Attributes = {
        init: JsonConstant,
        [key: string]: any
    };
    export type Cell = {
        hide_name: 0 | 1,
        type: string,
        parameters: Parameters,
        attributes: Attributes,
        port_directions: { [key: string]: 'input' | 'output' },
        connections: { [key: string]: BitVector }
    };

    export type Net = {
        hide_name: 0 | 1,
        bits: BitVector,
        attributes: { [key: string]: string }
    };

    export type Module = {
        ports: { [key: string]: Port },
        cells: { [key: string]: Cell },
        netnames: { [key: string]: Net }
    };

    export type Output = {
        modules: { [key: string]: Module }
    };

};

type ConvertOptions = {
    propagation?: number,
};

type Options = ConvertOptions & {
    optimize?: boolean,
    fsmexpand?: boolean,
    fsm?: boolean | "nomap",
    timeout?: number,
    lint?: boolean
};

type Output = {
    output?: Digitaljs.TopModule,
    yosys_output?: any,
    yosys_stdout: string,
    yosys_stderr: string,
    lint?: LintMessage[]
};

type Portmap = { [key: string]: string };
type Portmaps = { [key: string]: Portmap };

type Bit = Yosys.Bit | `bit${number}`;

type Net = Bit[];

type NetInfo = {
    source: undefined | Digitaljs.Port,
    targets: Digitaljs.Port[],
    name: undefined | string,
    source_positions: Digitaljs.SourcePosition[]
};

type BitInfo = {
    id: string,
    port: string,
    num: number
};

type LintMessage = {
    type: string,
    file: string,
    line: number,
    column: number,
    message: string
};
