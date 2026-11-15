#!/usr/bin/perl
# Replaces the values of ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH and GEMINI_API_KEY (from the environment)
# with [REDACTED] on every line (research note 12 R5: xcodebuild and gym echo arguments).
use strict; use warnings;
my @secrets = grep { defined && length } map { $ENV{$_} } qw(ASC_KEY_ID ASC_ISSUER_ID ASC_KEY_PATH GEMINI_API_KEY);
my @expanded;
for my $s (@secrets) { push @expanded, $s; (my $e = $s) =~ s/^~/$ENV{HOME}/; push @expanded, $e if $e ne $s; }
$| = 1;
while (my $line = <STDIN>) {
  for my $s (@expanded) { my $q = quotemeta($s); $line =~ s/$q/[REDACTED]/g; }
  print $line;
}
