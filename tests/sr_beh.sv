// SR latch (behavioral model)
module sr_latch(
  input s, r,
  output logic q, nq
);

  always_latch
    if (s || r) begin
      q = s && !r;
      nq = r && !s;
    end

endmodule
