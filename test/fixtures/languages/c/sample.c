#include <stdio.h>
#include "sample.h"

int add_points(struct Point a, struct Point b) {
    return a.x + b.x + a.y + b.y;
}
