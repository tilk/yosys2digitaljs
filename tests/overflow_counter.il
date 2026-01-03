attribute \generator "Amaranth"
attribute \src "<exec>:18"
attribute \top 1
module \top

  attribute \src "<exec>:13"
  attribute \init 4'0000
  wire width 4 \count

  attribute \src "<exec>:8"
  wire width 1 input 0  \en

  attribute \src "/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 1  \clk

  attribute \src "/lib/python3.11/site-packages/amaranth/hdl/_ir.py:283"
  wire width 1 input 2  \rst

  attribute \src "<exec>:9"
  wire width 1 output 3  \ovf

  wire width 5 $1

  wire width 4 $2

  attribute \src "<exec>:19"
  cell $eq $3
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 4
    parameter \Y_WIDTH 1
    connect \A \count [3:0]
    connect \B 4'1010
    connect \Y \ovf
  end

  attribute \src "<exec>:24"
  cell $add $4
    parameter \A_SIGNED 0
    parameter \B_SIGNED 0
    parameter \A_WIDTH 4
    parameter \B_WIDTH 1
    parameter \Y_WIDTH 5
    connect \A \count [3:0]
    connect \B 1'1
    connect \Y $1
  end

  attribute \src "<exec>:13"
  process $5
    assign $2 [3:0] \count [3:0]
    switch \en [0]
      case 1'1
        switch \ovf [0]
          case 1'1
            assign $2 [3:0] 4'0000
          case
            assign $2 [3:0] $1 [3:0]
        end
    end
    switch \rst [0]
      case 1'1
        assign $2 [3:0] 4'0000
    end
  end

  attribute \src "<exec>:13"
  cell $dff $6
    parameter \WIDTH 4
    parameter \CLK_POLARITY 1
    connect \D $2 [3:0]
    connect \CLK \clk [0]
    connect \Q \count
  end

end

