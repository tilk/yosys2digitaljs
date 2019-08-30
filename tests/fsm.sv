module fsm(input clk, rst, a, output b);

    logic [1:0] state;

    always_ff @(posedge clk or posedge rst)
        if (rst) state <= 2'b0;
        else casex(state)
//            2'b00: state <= 2'b01;
//            2'b01: state <= 2'b10;
            2'b10: if (a) state <= 2'b11; else state <= 2'b01;
            2'b11: state <= 2'b00;
            2'b00, 2'b01: state <= 2'b10;
        endcase

    always_comb
        case(state)
            2'b00, 2'b11: b = 0;
            2'b01, 2'b10: b = 1;
        endcase

endmodule
