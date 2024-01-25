const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    // const lib = b.addSharedLibrary(.{
    //     .name = "webview",
    //     .root_source_file = .{ .path = "main.zig" },
    //     .target = target,
    //     .optimize = optimize,
    // });

    const exe = b.addExecutable(.{
        .name = "webview",
        .root_source_file = .{ .path = "main.zig" },
        .target = target,
        .optimize = optimize,
    });

    // lib.setOutputDir("../../src/");

    // need to link objective c runtime in order for zig-objc to work
    exe.linkSystemLibrary("objc");
    // need to link AppKit in order to let zig-objc to reference AppKit related symbols in the objc runtime
    exe.linkFramework("AppKit"); // Link the AppKit framework
    exe.linkFramework("WebKit"); // Link the WebKit framework
    b.installArtifact(exe);

    // todo for future testing of the methods from cli can pass args like
    // if (b.option(bool, "enable-demo", "install the demo too") orelse false) {
    //     b.installArtifact(exe);
    // }
}