module rom(input [3:0] addr, output [3:0] data);

integer i;

logic [3:0] mem[15:0];

initial begin
    for (i = 0; i < 16; i = i+1) mem[i] = i;
end

assign data = mem[addr];

endmodule
