module cycleadder(input clk, input rst, input en, input [3:0] A, output [3:0] O);

always_ff @(posedge clk)
    if (rst) O <= 0;
    else if (en) O <= O + A;

endmodule
